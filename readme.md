# 🖼️ GalleryVault Web App

A clean, responsive, and lightweight client-side gallery web application designed for static hosting on **GitHub Pages**.

- **No backend or server required** — runs 100% on pure HTML, CSS, and JavaScript.
- **Bulk uploads supported** — drag and drop or multi-select dozens of photos at once.
- **Albums & Covers** — create albums with custom titles and select custom album cover photos.
- **Tags with Custom Color Picker** — categorize photos with colored badges, including custom hex color choices.
- **CSV / Excel Database** — reads and fetches metadata from `metadata.csv` (compatible with Microsoft Excel and Google Sheets).
- **Dedicated Media Folder** — all media assets reside in the `storage/` directory.
- **Separated Codebase** — clean separation between `index.html`, `css/style.css`, and `js/app.js`.

---

## 📁 Project Structure

```text
literate-octo-enigma/
├── index.html              # Main HTML markup
├── metadata.csv            # CSV database tracking photos, albums, covers & tags
├── css/
│   └── style.css           # Modern, responsive styles & theme
├── js/
│   └── app.js              # Gallery engine, CSV parser, album & tag logic
├── storage/                # Media folder where all pictures reside
│   ├── desert_dunes.svg
│   ├── emerald_valley.svg
│   ├── neon_metropolis.svg
│   ├── oasis_haven.svg
│   ├── skyline_reflections.svg
│   └── sunset_peaks.svg
└── readme.md               # Documentation & setup guide
```

---

## 📊 CSV Database Schema (`metadata.csv`)

The application fetches `metadata.csv` directly on startup. You can view or edit this file in **Microsoft Excel**, **Google Sheets**, or any text editor:

| Column | Description | Example |
| :--- | :--- | :--- |
| `id` | Unique photo ID | `img-001` |
| `filename` | Image filename in `storage/` | `sunset_peaks.svg` |
| `title` | Title or caption | `Golden Summit Sunset` |
| `album` | Album name | `Alpine Escapes` |
| `is_cover` | Whether this photo is the album cover (`true` / `false`) | `true` |
| `tags` | Semicolon-separated tags | `Sunset;Mountain;Landscape` |
| `tag_colors` | Semicolon-separated hex colors matching the tags | `#f59e0b;#6366f1;#10b981` |
| `date_added` | Date string (`YYYY-MM-DD`) | `2026-11-01` |
| `description` | Optional note or caption | `Stunning golden hour light` |

---

## 🚀 How to Deploy on GitHub Pages

1. **Push this repository to GitHub**:
   ```bash
   git add .
   git commit -m "Initial commit for Gallery Web App"
   git push origin main
   ```

2. **Enable GitHub Pages**:
   - Go to your repository on GitHub.
   - Click on **Settings** → **Pages** (under Code and automation).
   - Under **Build and deployment > Source**, select **Deploy from a branch**.
   - Under **Branch**, select `main` and the folder `/ (root)`.
   - Click **Save**.

3. Your gallery will be live at:
   `https://<username>.github.io/<repository-name>/`

---

## 📤 Adding New Photos (Bulk Upload Workflow)

Because GitHub Pages is a static host without a server-side filesystem write API, the app includes an interactive workflow:

1. Click the **＋ Bulk Upload** button in the app.
2. Drag and drop multiple pictures (PNG, JPG, WEBP, GIF, SVG).
3. Select an existing album or create a new album title.
4. Add tags with custom colors using the HTML5 color picker or palette swatches.
5. Click **Add to Gallery** — the photos are previewed immediately in your session!
6. Click **Database (CSV)** in the top bar:
   - Click **Download Updated metadata.csv** (replaces your local `metadata.csv`).
   - Click **Download Newly Uploaded Media** and drop them into the `storage/` folder.
7. Commit and push:
   ```bash
   git add .
   git commit -m "Added new album with photos"
   git push
   ```
   GitHub Pages will update your gallery within a minute!

---

## 🛠️ Features

- **Album View**: Displays album cards with cover photos, album titles, photo count badges, and tag previews.
- **Photos View**: Filter by album, search by keywords, filter by one or more colored tag pills, and sort by date or title.
- **Fullscreen Lightbox**: Full-resolution image viewer with keyboard navigation (`←`, `→`, `Esc`), metadata display, and 1-click **Set as Album Cover**.
- **Color-Coded Tags**: Each tag can have an individual color chosen with the interactive color picker; text contrast is automatically calculated for optimal readability.
- **Direct CSV Import/Export**: Export current gallery state to CSV anytime, or import an external CSV/Excel file.
