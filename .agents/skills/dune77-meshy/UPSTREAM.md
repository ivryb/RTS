# Ownership and provenance

This project-owned skill replaces the overlapping `meshy-3d-agent` and
`meshy-3d-generation` installations on September 6, 2026. Maintain it here; it is not
an upstream-managed entry in `skills-lock.json`.

The previous installations came from
[meshy-dev/meshy-3d-agent](https://github.com/meshy-dev/meshy-3d-agent):

- `skills/meshy-openclaw/SKILL.md`, named `meshy-3d-agent`, declared MIT-0.
- `skills/meshy-3d-generation/SKILL.md`, version 0.5.0, declared MIT.

The new entrypoint and references are rewritten around Dune's approved workflow.
The duplicated full API snapshots, installation ceremonies, and mandatory follow-up
questions are replaced by targeted official documentation links. Historical versions
remain in Git. The download example uses `Path.parent`, including for bare filenames.
