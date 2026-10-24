# R33 — why screenshots cannot be produced in this sandbox (verified 2026-10-24)

npx-free headless Chromium from npm (@sparticuz/chromium 153.0.0, shipped binary, no CDN needed):
- extracted to /tmp/chromium (executablePath works)
- launch fails: 'error while loading shared libraries: libnspr4.so'

## ldd /tmp/chromium — missing libraries
	libnspr4.so => not found
	libnss3.so => not found
	libnssutil3.so => not found

## availability of the missing libraries on this image
find / -name 'libnss3.so*' -o -name 'libnspr4.so*'  =>  (no result)

## why they cannot be installed
- apt/ubuntu mirrors are not in the outbound allow-list (only github.com, codeload.github.com, api.github.com, registry.npmjs.org, pypi.org, files.pythonhosted.org).
- registry.npmjs.org has no package that ships libnspr4/libnss3 for linux (checked libnss3, nss-linux, linux-nss, chromium-deps, playwright-deps: all 404).
- playwright's own chromium download host (playwright.azureedge.net) is not in the allow-list either.
