// m6-vlm-check.mjs — VLM visual sign-off on the M6 run-detail screenshot
import fs from "node:fs";

const IMG = "/home/z/my-project/download/m6-dash-verify/02-run-detail.png";
const b64 = fs.readFileSync(IMG).toString("base64");

const res = await fetch("http://127.0.0.1:3031/v1/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "agnes-3.0-flash",
    max_tokens: 300,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "This is a run-detail dialog from a developer dashboard. Answer strictly: (1) Does the dialog header strip contain the text 'isolation: bwrap'? (2) Is the layout legible and free of overlapping/clipped text? (3) Any visual defects? Reply in <=3 short lines." },
          { type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } },
        ],
      },
    ],
  }),
});
const data = await res.json();
console.log("HTTP", res.status);
console.log(data.choices?.[0]?.message?.content ?? JSON.stringify(data).slice(0, 400));
