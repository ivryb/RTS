const paths = {
  move: "M5 19 19 5M6 5h13v13M4 12v8h8",
  attack: "m5 3 16 16-2 2L3 5V3h2ZM15 14l-4 7M14 15l7-4M4 20l5-5",
  "attack-ground": "M12 2v5m0 10v5M2 12h5m10 0h5M7 7l10 10m0-10L7 17",
  stop: "M5 5h14v14H5Z",
  build: "m4 20 11-11M14 3l7 7-3 3-7-7 3-3ZM3 17l4 4",
  turret: "M5 21h14M7 21v-5h10v5M12 16v-5M6 7h11v4H6ZM17 8h6M9 7V4h5v3",
  "command-center": "M3 10l5-4h8l5 4v8l-5 3H8l-5-3V10ZM3 10h18M8 6V3h8v3M9 21v-7h6v7M1 13h2m18 0h2M12 3V1",
  rally: "M6 22V3m0 1h13l-3 4 3 4H6M2 22h8",
};

export function hudIcon(kind: keyof typeof paths) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.4");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  const path = document.createElementNS(svg.namespaceURI, "path");
  path.setAttribute("d", paths[kind]);
  svg.append(path);
  return svg;
}

export function healthMeter(health: number, maximum: number) {
  const meter = document.createElement("progress");
  meter.className = "health-meter";
  meter.max = maximum;
  meter.value = health;
  meter.setAttribute("aria-label", "Health");
  return meter;
}
