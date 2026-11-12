import { states } from "./states";

const params = new URLSearchParams(location.search);
if (params.has("frame")) {
  await import("./scene");
} else {
  document.head.insertAdjacentHTML("beforeend", `<style>
    *{box-sizing:border-box}body{margin:0;background:#202020;color:#eee;font:14px system-ui}
    header{padding:16px 22px;border-bottom:1px solid #555;display:flex;gap:24px;align-items:center}
    h1{font-size:18px;margin:0}p{color:#bbb;margin:4px 0}main{display:flex;height:calc(100vh - 80px)}
    nav{width:210px;flex-shrink:0;overflow:auto;padding:12px}a{display:block;color:#ccc;padding:7px 10px;text-decoration:none}
    a[aria-current=true]{background:#444;color:white}section{flex:1;overflow:auto;padding:16px}iframe{border:1px solid #666;display:block;background:#333}
    select{background:#333;color:white;padding:6px}label{margin-left:auto}button{padding:6px}
  </style>`);
  document.body.innerHTML = `<header><div><h1>Dune77 · UI review</h1><p>Production HUD, frozen fixtures. No match setup or 3D assets required.</p></div><label>Viewport <select><option value="1440x900">1440 × 900</option><option value="1920x1080">1920 × 1080</option><option value="1024x768">1024 × 768</option><option value="640x720">640 × 720</option></select></label></header><main><nav></nav><section><iframe title="UI state preview"></iframe></section></main>`;
  const frame = document.querySelector("iframe")!;
  const select = document.querySelector("select")!;
  const show = (state: string) => {
    frame.src = `?frame=1&state=${state}`;
    history.replaceState(null, "", `?state=${state}`);
    document.querySelectorAll("nav a").forEach((link) => link.setAttribute("aria-current", String(link.getAttribute("href") === `?state=${state}`)));
  };
  for (const state of states) {
    const link = document.createElement("a");
    link.href = `?state=${state}`;
    link.textContent = state.replaceAll("-", " ");
    link.onclick = (event) => { event.preventDefault(); show(state); };
    document.querySelector("nav")!.append(link);
  }
  const resize = () => {
    const [width, height] = select.value.split("x");
    frame.style.width = `${width}px`;
    frame.style.height = `${height}px`;
  };
  select.onchange = resize;
  resize();
  show(states.find((state) => state === params.get("state")) ?? "command-center");
}
