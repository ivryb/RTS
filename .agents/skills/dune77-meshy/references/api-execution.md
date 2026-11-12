# Meshy API execution

Use this reference only for an API workflow. API requests send the requested images,
models, or prompts to Meshy; asset downloads use the URLs returned in its response.

## Access and current contract

Read `MESHY_API_KEY` from the environment or the project's `.env`. Report only whether
it is available; do not print key fragments or scan shell profiles. Persist a key
only when requested, in the project's ignored `.env`. If access is unavailable,
explain the missing credential or account permission and let the user configure it.

Use `https://api.meshy.ai` with a Bearer authorization header for API requests.
Do not attach that header to asset-download requests. Check the current
[API documentation](https://docs.meshy.ai/en/api) for the selected endpoint, pricing,
and retention before starting a paid task. `GET /openapi/v1/balance` provides the
account balance. Avoid copying a full API catalog or hard-coding a permanent price.

## Task lifecycle

1. Reuse the project's suitable runner, or write a bounded script for the selected
   operation. POST creates an asynchronous task; save its returned `result` ID and
   endpoint immediately with the input parameters in `meshy_output/<asset>/`.
2. Poll that endpoint's task URL with bounded backoff and report progress. A local
   polling timeout does not cancel the remote task. Save the latest status and resume
   GET requests for the same ID instead of submitting another generation.
3. On `SUCCEEDED`, save the response and download the requested assets immediately.
   Signed URLs and remote retention are temporary. On `FAILED` or `CANCELED`, retain
   the task ID and error and diagnose before considering another paid submission.
4. A failed download is a download retry, not a new generation. Refresh the existing
   task response if a returned URL expired. Verify downloaded files before marking
   the workflow complete.

Retry transient reads with bounded backoff. If a POST response is lost, inspect
existing tasks before repeating the request: a timeout does not establish that task
creation failed. Do not change the prompt, model, or paid scope as an automatic retry.

## Download example

For a one-off Python runner, this helper handles both nested destinations and bare
filenames. Pass a destination inside the asset directory in normal use. It uses a
separate unauthenticated request for the returned download URL.

```python
from pathlib import Path
from urllib.request import urlopen
import shutil


def download(url, destination):
    path = Path(destination)
    # A bare filename has parent '.', rather than the empty dirname that fails mkdir.
    path.parent.mkdir(parents=True, exist_ok=True)
    with urlopen(url, timeout=300) as response, path.open("wb") as output:
        shutil.copyfileobj(response, output)
    return path
```

Example: `download(glb_url, Path(project_dir) / "retextured.glb")`. Inspect the GLB
and requested texture maps after download; HTTP success alone is not visual proof.
