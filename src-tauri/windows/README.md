# Windows installer artwork

These bitmaps are referenced from `bundle.windows` in `../tauri.conf.json`.

| File          | Used by            | Dimensions | Format        |
| ------------- | ------------------ | ---------- | ------------- |
| `header.bmp`  | NSIS header        | 150 × 57   | 24-bit BMP    |
| `sidebar.bmp` | NSIS welcome/finish| 164 × 314  | 24-bit BMP    |
| `banner.bmp`  | WiX (MSI) banner   | 493 × 58   | 24-bit BMP    |
| `dialog.bmp`  | WiX (MSI) dialogs  | 493 × 312  | 24-bit BMP    |

NSIS and WiX expect uncompressed 24-bit bitmaps without an alpha channel, so
keep those exact dimensions and formats when replacing them.

The artwork follows the download mark and violet gradient from
`../../static/logo.svg`.
