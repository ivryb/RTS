# Robot-dog rigging prototype

These Blender scripts test two approaches for a mechanical quadruped:

- Build a rigid bone hierarchy from disconnected mesh islands and an authored `example-rig.json`.
- Rigidify a Meshy quadruped rig, or retarget a known robotic-dog walk onto it.

The retargeting experiment used [Walking Robotic Dog by Creoplan](https://sketchfab.com/3d-models/walking-robotic-dog-cb8157f40d39456d9f37865b4e6e7477), licensed under CC BY 4.0. `REFERENCE_LICENSE.txt` contains that license. The third-party model and generated test outputs stay in the ignored `art/workbench/` directory.

Run these scripts through Blender's background mode. Their command-line arguments are defined at the top of each file. Do not run Blender inside a restricted sandbox on macOS; use an approved unsandboxed process or inspect the GLB without Blender.
