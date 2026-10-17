#!/usr/bin/env python3
"""Unown LiveCodeBench scorer — faithful port of the official LCB grader.

Source of truth: lcb_runner/evaluation/testing_util.py @ LiveCodeBench/LiveCodeBench
main (fetched 2026-10-17; vendored copy kept at
/home/z/my-project/bench-data/livecodebench/lcb_testing_util.py for reference).
Ported semantics, kept deliberately identical:

  - `import_string` prelude (stdlib-only imports + recursionlimit 50000) is
    prepended to every solution before exec.
  - call-based (LeetCode functional) problems: inputs are parsed per line with
    json.loads into positional args, `Solution()` instantiated when the code
    defines it, `method(*args)` compared with `==` against json.loads of the
    expected output, tuples normalized to lists.
  - stdin (AtCoder) problems: `if __name__ == "__main__":` guard is unwrapped,
    the whole program is re-wrapped into `wrapped_function()`, sys.stdin is
    mocked (read/readline/readlines + .buffer), stdout is captured, and the
    comparison is line-wise: exact string match per stripped line, else
    whitespace-split token lists parsed as Decimals ("1.0" == "1.00").
  - grading stops at the FIRST failing test (LCB behavior), and each test is
    capped by SIGALRM (LCB default: 6 s).
  - `reliability_guard` from the LCB file is applied before running model code
    (os.system/kill/fork/subprocess etc. nulled). NOTE: like LCB itself, this
    is NOT a security sandbox; the runner additionally executes this process in
    a throwaway scratch directory with a wall-clock kill.

Deliberate deviations (documented, none affect scoring semantics):
  - numpy import dropped (the LCB file imports it but never uses it in the
    grading paths) — keeps this file stdlib-only.
  - results are reported as JSON on stdout instead of return values.

Usage: python3 scorer.py <job.json>
  job.json = {"code": str, "fn_name": str|null, "tests": [{"input","output","testtype"}],
              "timeout_per_test": int}
"""

import ast
import io
import json
import platform
import signal
import sys
import time
import zlib  # noqa: F401  (kept: stdlib only, parity with LCB import set)
from decimal import Decimal
from io import StringIO
from types import ModuleType
from unittest.mock import patch, mock_open

import_string = "from string import *\nfrom re import *\nfrom datetime import *\nfrom collections import *\nfrom heapq import *\nfrom bisect import *\nfrom copy import *\nfrom math import *\nfrom random import *\nfrom statistics import *\nfrom itertools import *\nfrom functools import *\nfrom operator import *\nfrom io import *\nfrom sys import *\nfrom json import *\nfrom builtins import *\nfrom typing import *\nimport string\nimport re\nimport datetime\nimport collections\nimport heapq\nimport bisect\nimport copy\nimport math\nimport random\nimport statistics\nimport itertools\nimport functools\nimport operator\nimport io\nimport sys\nimport json\nsys.setrecursionlimit(50000)\n"


class TimeoutException(Exception):
    pass


def timeout_handler(signum, frame):
    print("timeout occured: alarm went off")
    raise TimeoutException


class Capturing(list):
    def __enter__(self):
        self._stdout = sys.stdout
        sys.stdout = self._stringio = StringIO()
        self._stringio.close = lambda x: 1
        return self

    def __exit__(self, *args):
        self.append(self._stringio.getvalue())
        del self._stringio
        sys.stdout = self._stdout


class MockStdinWithBuffer:
    def __init__(self, inputs: str):
        self.inputs = inputs
        self._stringio = StringIO(inputs)
        self.buffer = MockBuffer(inputs)

    def read(self, *args):
        return self.inputs

    def readline(self, *args):
        return self._stringio.readline(*args)

    def readlines(self, *args):
        return self.inputs.split("\n")

    def __getattr__(self, name):
        return getattr(self._stringio, name)


class MockBuffer:
    def __init__(self, inputs: str):
        self.inputs = inputs.encode("utf-8")

    def read(self, *args):
        return self.inputs

    def readline(self, *args):
        return self.inputs.split(b"\n")[0] + b"\n"


def truncatefn(s, length=300):
    if not isinstance(s, str):
        s = str(s)
    if len(s) <= length:
        return s
    return s[: length // 2] + "...(truncated) ..." + s[-length // 2 :]


def clean_if_name(code: str) -> str:
    try:
        astree = ast.parse(code)
        last_block = astree.body[-1]
        if isinstance(last_block, ast.If):
            condition = last_block.test
            if ast.unparse(condition).strip() == "__name__ == '__main__'":
                code = (
                    ast.unparse(astree.body[:-1])
                    + "\n"
                    + ast.unparse(last_block.body)
                )
    except Exception:
        pass
    return code


def make_function(code: str) -> str:
    try:
        import_stmts = []
        all_other_stmts = []
        astree = ast.parse(code)
        for stmt in astree.body:
            if isinstance(stmt, (ast.Import, ast.ImportFrom)):
                import_stmts.append(stmt)
            else:
                all_other_stmts.append(stmt)

        function_ast = ast.FunctionDef(
            name="wrapped_function",
            args=ast.arguments(
                posonlyargs=[], args=[], kwonlyargs=[], kw_defaults=[], defaults=[]
            ),
            body=all_other_stmts,
            decorator_list=[],
            lineno=-1,
        )
        main_code = (
            import_string
            + "\n"
            + ast.unparse(import_stmts)
            + "\n"
            + ast.unparse(function_ast)
        )
        return main_code
    except Exception:
        return code


def call_method(method, inputs):
    if isinstance(inputs, list):
        inputs = "\n".join(inputs)

    inputs_line_iterator = iter(inputs.split("\n"))
    mock_stdin = MockStdinWithBuffer(inputs)

    @patch("builtins.open", mock_open(read_data=inputs))
    @patch("sys.stdin", mock_stdin)
    @patch("sys.stdin.readline", lambda *args: next(inputs_line_iterator))
    @patch("sys.stdin.readlines", lambda *args: inputs.split("\n"))
    @patch("sys.stdin.read", lambda *args: inputs)
    def _inner_call_method(_method):
        try:
            return _method()
        except SystemExit:
            pass
        finally:
            pass

    return _inner_call_method(method)


def get_function(compiled_sol, fn_name: str):
    try:
        assert hasattr(compiled_sol, fn_name)
        return getattr(compiled_sol, fn_name)
    except Exception:
        return None


def compile_code(code: str, timeout: int):
    signal.alarm(timeout)
    try:
        tmp_sol = ModuleType("tmp_sol", "")
        exec(code, tmp_sol.__dict__)
        if "class Solution" in code:
            compiled_sol = tmp_sol.Solution()
        else:
            compiled_sol = tmp_sol
        assert compiled_sol is not None
    finally:
        signal.alarm(0)
    return compiled_sol


def convert_line_to_decimals(line: str):
    try:
        decimal_line = [Decimal(elem) for elem in line.split()]
    except Exception:
        return False, []
    return True, decimal_line


def get_stripped_lines(val: str):
    val = val.strip()
    return [val_line.strip() for val_line in val.split("\n")]


def grade_call_based(code, all_inputs, all_outputs, fn_name, timeout):
    code = import_string + "\n\n" + code
    compiled_sol = compile_code(code, timeout)

    if compiled_sol is None:
        return

    method = get_function(compiled_sol, fn_name)
    if method is None:
        return

    all_inputs = [[json.loads(line) for line in inputs.split("\n")] for inputs in all_inputs]
    all_outputs = [json.loads(output) for output in all_outputs]

    total_execution = 0
    all_results = []
    for idx, (gt_inp, gt_out) in enumerate(zip(all_inputs, all_outputs)):
        signal.alarm(timeout)
        try:
            start = time.time()
            prediction = method(*gt_inp)
            total_execution += time.time() - start
            signal.alarm(0)

            if isinstance(prediction, tuple):
                prediction = list(prediction)

            tmp_result = prediction == gt_out
            all_results.append(tmp_result)

            if not tmp_result:
                return all_results, {
                    "output": truncatefn(prediction),
                    "inputs": truncatefn(gt_inp),
                    "expected": truncatefn(gt_out),
                    "error_code": -2,
                    "error_message": "Wrong Answer",
                }
        except Exception as e:
            signal.alarm(0)
            if "timeoutexception" in repr(e).lower():
                all_results.append(-3)
                return all_results, {
                    "error": truncatefn(repr(e)),
                    "error_code": -3,
                    "error_message": "Time Limit Exceeded",
                    "inputs": truncatefn(gt_inp),
                    "expected": truncatefn(gt_out),
                }
            else:
                all_results.append(-4)
                return all_results, {
                    "error": truncatefn(repr(e)),
                    "error_code": -4,
                    "error_message": "Runtime Error",
                    "inputs": truncatefn(gt_inp),
                    "expected": truncatefn(gt_out),
                }
        finally:
            signal.alarm(0)

    return all_results, {"execution time": total_execution}


def grade_stdio(code, all_inputs, all_outputs, timeout):
    code = clean_if_name(code)
    code = make_function(code)

    compiled_sol = compile_code(code, timeout)
    if compiled_sol is None:
        return

    method = get_function(compiled_sol, "wrapped_function")
    if method is None:
        return

    all_results = []
    total_execution_time = 0
    for idx, (gt_inp, gt_out) in enumerate(zip(all_inputs, all_outputs)):
        signal.alarm(timeout)
        with Capturing() as captured_output:
            try:
                start = time.time()
                call_method(method, gt_inp)
                total_execution_time += time.time() - start
                signal.alarm(0)
            except Exception as e:
                signal.alarm(0)
                if "timeoutexception" in repr(e).lower():
                    all_results.append(-3)
                    return all_results, {
                        "error": truncatefn(repr(e)),
                        "error_code": -3,
                        "error_message": "Time Limit Exceeded",
                        "inputs": truncatefn(gt_inp),
                        "expected": truncatefn(gt_out),
                    }
                else:
                    all_results.append(-4)
                    return all_results, {
                        "error": truncatefn(repr(e)),
                        "error_code": -4,
                        "error_message": "Runtime Error",
                        "inputs": truncatefn(gt_inp),
                        "expected": truncatefn(gt_out),
                    }
            finally:
                signal.alarm(0)

        prediction = captured_output[0]

        stripped_prediction_lines = get_stripped_lines(prediction)
        stripped_gt_out_lines = get_stripped_lines(gt_out)

        WA_send_args = {
            "output": truncatefn(prediction),
            "inputs": truncatefn(gt_inp),
            "expected": truncatefn(gt_out),
            "error_code": -2,
        }

        if len(stripped_prediction_lines) != len(stripped_gt_out_lines):
            all_results.append(-2)
            WA_send_args["error_message"] = "Wrong answer: mismatched output length"
            return all_results, WA_send_args

        for output_line_idx, (
            stripped_prediction_line,
            stripped_gt_out_line,
        ) in enumerate(zip(stripped_prediction_lines, stripped_gt_out_lines)):
            WA_send_args["error_message"] = (
                f"Wrong answer at {output_line_idx=}: {truncatefn(stripped_prediction_line)} != {truncatefn(stripped_gt_out_line)}"
            )

            if stripped_prediction_line == stripped_gt_out_line:
                continue

            success, decimal_prediction_line = convert_line_to_decimals(
                stripped_prediction_line
            )
            if not success:
                all_results.append(-2)
                return all_results, WA_send_args
            success, decimal_gtout_line = convert_line_to_decimals(stripped_gt_out_line)
            if not success:
                all_results.append(-2)
                return all_results, WA_send_args

            if decimal_prediction_line == decimal_gtout_line:
                continue

            all_results.append(-2)
            return all_results, WA_send_args
        all_results.append(True)

    return all_results, {"execution time": total_execution_time}


def reliability_guard(maximum_memory_bytes=None):
    """LCB's guard (NOT a security sandbox — see LCB's own docstring)."""
    if maximum_memory_bytes is not None:
        import resource

        resource.setrlimit(
            resource.RLIMIT_AS, (maximum_memory_bytes, maximum_memory_bytes)
        )
        resource.setrlimit(
            resource.RLIMIT_DATA, (maximum_memory_bytes, maximum_memory_bytes)
        )
        if not platform.uname().system == "Darwin":
            resource.setrlimit(
                resource.RLIMIT_STACK, (maximum_memory_bytes, maximum_memory_bytes)
            )

    import builtins

    builtins.quit = None

    import os

    os.environ["OMP_NUM_THREADS"] = "1"

    os.kill = None
    os.system = None
    os.putenv = None
    os.remove = None
    os.removedirs = None
    os.rmdir = None
    os.fchdir = None
    os.setuid = None
    os.fork = None
    os.forkpty = None
    os.killpg = None
    os.rename = None
    os.renames = None
    os.truncate = None
    os.replace = None
    os.unlink = None
    os.fchmod = None
    os.fchown = None
    os.chmod = None
    os.chown = None
    os.chroot = None
    os.lchflags = None
    os.lchmod = None
    os.lchown = None
    os.getcwd = None
    os.chdir = None

    import shutil

    shutil.rmtree = None
    shutil.move = None
    shutil.chown = None

    import subprocess

    subprocess.Popen = None

    # CPython: `__builtins__` is a dict in imported modules but the module
    # object in __main__ (LCB's original dict-indexing works in their
    # multiprocessing context; guard both shapes here).
    if isinstance(__builtins__, dict):
        __builtins__["help"] = None
    else:
        try:
            __builtins__.help = None
        except Exception:
            pass

    sys.modules["ipdb"] = None
    sys.modules["joblib"] = None
    sys.modules["resource"] = None
    sys.modules["psutil"] = None
    sys.modules["tkinter"] = None


def main():
    job = json.load(open(sys.argv[1]))
    code = job["code"]
    fn_name = job.get("fn_name")
    tests = job["tests"]
    timeout = int(job.get("timeout_per_test", 6))

    # LCB sets this process-wide before grading (compute_code_generation_metrics)
    if hasattr(sys, "set_int_max_str_digits"):
        sys.set_int_max_str_digits(50000)

    signal.signal(signal.SIGALRM, timeout_handler)
    reliability_guard()

    outcome = {
        "outcome": "pass",
        "error_code": 0,
        "error_message": None,
        "n_tests": len(tests),
        "n_run": 0,
        "failed_test_index": None,
        "failure": None,
        "execution_time_s": 0.0,
    }

    if fn_name is None:
        # standard input problem
        which = "stdio"
    else:
        which = "call"

    try:
        if which == "call":
            results, meta = grade_call_based(
                code,
                [t["input"] for t in tests],
                [t["output"] for t in tests],
                fn_name,
                timeout,
            )
        else:
            results, meta = grade_stdio(
                code,
                [t["input"] for t in tests],
                [t["output"] for t in tests],
                timeout,
            )
    except Exception as e:
        results, meta = [-4], {"error_code": -4, "error_message": f"Error during testing: {truncatefn(repr(e))}"}

    outcome["n_run"] = len(results)
    first_fail = None
    for i, r in enumerate(results):
        if r is not True:
            first_fail = i
            break

    if first_fail is not None:
        code_val = results[first_fail]
        # LCB results can carry True (pass), False (call-based wrong answer —
        # the -2 code lives in metadata), or negative ints (stdio WA / TLE /
        # RTE / global timeout / TestRunnerError).
        if code_val is False or code_val == -2:
            outcome["outcome"] = "wa"
        elif code_val == -3:
            outcome["outcome"] = "tle"
        else:
            outcome["outcome"] = "rte"
        meta_code = meta.get("error_code") if isinstance(meta, dict) else None
        outcome["error_code"] = (
            meta_code
            if isinstance(meta_code, int)
            else (-2 if code_val is False else code_val if isinstance(code_val, int) else -4)
        )
        outcome["error_message"] = meta.get("error_message") if isinstance(meta, dict) else None
        outcome["failed_test_index"] = first_fail
        outcome["failure"] = {k: v for k, v in (meta or {}).items() if k != "execution time"}

    if isinstance(meta, dict) and "execution time" in meta:
        outcome["execution_time_s"] = round(float(meta["execution time"]), 3)

    json.dump(outcome, sys.stdout)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
