// Compiled into a scratch install root by uninstall-windows.test.ts, so the
// test can run `uninstall` FROM the binary that install must delete.
import { cmdUninstall, parseUninstallFlags } from "../../src/uninstall.ts";

const [command, ...argv] = process.argv.slice(2);
if (command !== "uninstall") {
        console.error(`expected the uninstall command, got: ${command ?? "(none)"}`);
        process.exit(2);
}
const { flags, error } = parseUninstallFlags(argv);
if (error) {
        console.error(error);
        process.exit(2);
}
process.exit(cmdUninstall(flags, {}));
