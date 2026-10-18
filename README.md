# labelabelabel

Web app for designing and printing labels on a Brother PT-P750W.

- Labels are JSON documents: a row of text, QR, line and space blocks laid out along the tape.
- The same renderer runs in the browser for the preview and on the server for printing, so the
  preview is the exact bitmap that gets printed.
- Tapes are recorded when they are inserted, and labels remember which tape they were made for.
  Print jobs wait until the right tape is loaded.
- Custom TTF/OTF fonts can be uploaded. Pixel fonts are detected and only scaled by whole numbers.

## Running

```sh
docker run -p 3000:3000 -v labelabelabel:/data -e PRINTER_HOST=192.168.178.109 \
  ghcr.io/bo0tzz/labelabelabel:latest
```

Releases are tagged by version (`ghcr.io/bo0tzz/labelabelabel:0.1.0`); `main` and `sha-<commit>`
track the main branch.

| Variable            | Default   | Purpose                                                                  |
| ------------------- | --------- | ------------------------------------------------------------------------ |
| `PRINTER_HOST`      |           | Address of the PT-P750W.                                                 |
| `PRINTER_TRANSPORT` | `ipp`     | `ipp` tracks jobs; `raw` sends to port 9100 without feedback.            |
| `DATA_DIR`          | `./data`  | SQLite database and uploaded fonts. `/data` in the image.                |
| `FONTS_DIR`         | `./fonts` | Bundled fonts.                                                           |
| `USER_HEADER`       |           | Header with the user name from a forward-auth proxy, e.g. `remote-user`. |

The image trusts `X-Forwarded-Proto` and `X-Forwarded-Host` from a reverse proxy, falling back
to the request itself when they are absent. Override `PROTOCOL_HEADER`/`HOST_HEADER` if your
proxy uses other headers.

The app needs SNMP (UDP 161) and IPP (TCP 631) access to the printer. Both work across routed
VLANs; a multus interface on the printer's VLAN is only needed for mDNS discovery, which is not
implemented yet.

On Kubernetes, run a single replica with the `Recreate` strategy: the app polls the printer and
holds the job queue in-process. Put `/data` on a block volume (ReadWriteOnce), not NFS, because
SQLite needs working file locks.

## Development

```sh
mise install
pnpm install
echo PRINTER_HOST=192.168.178.109 > .env
pnpm dev
```

- `pnpm test`, `pnpm check`, `pnpm lint`
- `pnpm exec tsx scripts/render-preview.ts <dir>` renders sample labels to PNG.
- `pnpm exec tsx scripts/test-print.ts <host> <basic|hires|ipp>` prints calibration labels;
  `--preview <dir>` writes PNGs instead.
- After changing `src/lib/server/db/schema.ts`, run `pnpm exec drizzle-kit generate`.

The printer protocol is Brother's
[Raster Command Reference for the PT-E550W/P750W/P710BT](https://download.brother.com/welcome/docp100064/cv_pte550wp750wp710bt_eng_raster_102.pdf).

## Fonts

Bundled fonts are under the SIL Open Font License, except Material Symbols (Apache 2.0); see the
license file next to each font.

- [Atkinson Hyperlegible Next](https://github.com/googlefonts/atkinson-hyperlegible-next)
- [Barlow Condensed](https://github.com/jpt/barlow)
- [Departure Mono](https://departuremono.com)
- [JetBrains Mono](https://www.jetbrains.com/lp/mono/)
- [Material Symbols](https://github.com/google/material-design-icons), reduced to the weight and
  fill axes with `fonttools varLib.instancer ... GRAD=0 opsz=20`
- [Schraubenkiste](http://www.catfonts.de/Schraubenkiste.html)
- [Silkscreen](https://kottke.org/plus/type/silkscreen/)
