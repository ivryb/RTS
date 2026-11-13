import sys, json
for l in open(sys.argv[1]):
    if l.startswith("=="): print(l.strip()); continue
    if not l.startswith("{"): 
        if "rror" in l: print("  ", l.strip()[:200])
        continue
    d = json.loads(l)
    cpu = {k.replace("gpu-process:", "gpu:").replace("chrome-headless", "main"): v for k, v in d["cpuCoresByThread"].items()}
    print(f'{d["label"]:<16} {d["fps"]:>6} fps  frame p50 {d["frameMs"]["p50"]:>6} p95 {d["frameMs"]["p95"]:>6}  js {d["callbackMs"]["p50"]:>4}  tri {d["triangles"]/1e6:.2f}M calls {d["drawCalls"]}  ready {d.get("startup", {}).get("readyMs", d.get("startupMs"))}  {d["gpu"][:50]}  {cpu}  {d["errors"][:1]}')
