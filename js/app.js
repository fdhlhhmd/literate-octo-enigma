/**
 * Gallery Web App - Core JavaScript
 * Fully client-side, GitHub Pages ready, CSV/Excel database backed.
 */

(function () {
  'use strict';

  // =========================================================================
  // State Management
  // =========================================================================
  const state = {
    photos: [],               // Array of Photo objects
    tagColors: {},            // Tag name -> Hex color string
    currentView: 'albums',    // 'albums' | 'photos'
    filterAlbum: null,        // string or null
    selectedTags: new Set(),  // Set of tag names currently active in filter
    searchQuery: '',          // Current search text
    sortOrder: 'date-desc',   // 'date-desc' | 'date-asc' | 'title-asc' | 'album-asc'
    lightboxIndex: -1,        // Index in currently filtered photos list
    stagedUploadFiles: [],    // Array of { file: File, previewUrl: string, title: string }
    stagedTags: [],           // Array of { name: string, color: string }
    newlyAddedFiles: [],      // Files added in this session needing to be saved to storage/
    highlightAlbum: '',       // Album name showcased in Highlight section ('' = all)
    carouselWidth: 1100,      // Interactive width for 3D carousel in px or 'full'
  };

  const DEFAULT_TAG_COLORS = [
    '#c8a97e', '#8fb49a', '#7f9cc4', '#c48a8a',
    '#a58fc4', '#6fb3b8', '#d0a35f', '#9aa66f', '#8a8a8f'
  ];

  // =========================================================================
  // CSV Utilities (RFC 4180 Compliant)
  // =========================================================================

  function parseCSV(text) {
    const lines = [];
    let row = [''];
    let inQuotes = false;

    // Normalize newlines
    const cleanText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    for (let i = 0; i < cleanText.length; i++) {
      const char = cleanText[i];
      const nextChar = cleanText[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          row[row.length - 1] += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        row.push('');
      } else if (char === '\n' && !inQuotes) {
        lines.push(row);
        row = [''];
      } else {
        row[row.length - 1] += char;
      }
    }
    if (row.length > 1 || row[0] !== '') {
      lines.push(row);
    }

    if (lines.length === 0) return [];

    const headers = lines[0].map(h => h.trim());
    const data = [];

    for (let i = 1; i < lines.length; i++) {
      const currentLine = lines[i];
      if (currentLine.length === 1 && currentLine[0].trim() === '') continue;
      const entry = {};
      headers.forEach((header, idx) => {
        entry[header] = currentLine[idx] !== undefined ? currentLine[idx].trim() : '';
      });
      data.push(entry);
    }

    return data;
  }

  function serializeCSV(data) {
    if (!data || data.length === 0) return '';
    const headers = ['id', 'filename', 'title', 'album', 'is_cover', 'tags', 'tag_colors', 'date_added', 'description'];

    const escapeField = (val) => {
      const str = String(val === undefined || val === null ? '' : val);
      if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes(';')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const headerRow = headers.join(',');
    const rows = data.map(item => {
      return headers.map(h => escapeField(item[h])).join(',');
    });

    return [headerRow, ...rows].join('\n');
  }

  // =========================================================================
  // Color & UI Utilities
  // =========================================================================

  function getContrastColor(hexColor) {
    if (!hexColor || hexColor.charAt(0) !== '#') return '#ffffff';
    let hex = hexColor.substring(1);
    if (hex.length === 3) {
      hex = hex.split('').map(c => c + c).join('');
    }
    if (hex.length !== 6) return '#ffffff';
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    const yiq = (r * 299 + g * 587 + b * 114) / 1000;
    return yiq >= 145 ? '#0f172a' : '#ffffff';
  }

  function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span class="toast-dot"></span><span>${escapeHTML(message)}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  function icon(name, extraClass = '') {
    return `<svg class="icon ${extraClass}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  }

  // Renders a tag chip. The tag colour drives the dot, tint and border via --tag.
  function tagBadge(tag, { size = '', active = false, button = false, removable = null } = {}) {
    const color = state.tagColors[tag] || '#a8a49c';
    const cls = `tag-badge ${size} ${active ? 'active' : ''}`.trim();
    const removeBtn = removable !== null
      ? `<span class="tag-remove remove-staged-tag" data-index="${removable}" title="Remove">${icon('close', 'icon-sm')}</span>`
      : '';
    const inner = `<span class="tag-color-dot"></span>${escapeHTML(tag)}${active ? icon('close', 'icon-sm') : ''}${removeBtn}`;
    return button
      ? `<button type="button" class="${cls}" style="--tag:${color}" data-tag="${escapeHTML(tag)}">${inner}</button>`
      : `<span class="${cls}" style="--tag:${color}">${inner}</span>`;
  }

  function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d)) return iso;
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function getImageSrc(photo) {
    if (photo.blobUrl) return photo.blobUrl;
    if (photo.filename.startsWith('http://') || photo.filename.startsWith('https://') || photo.filename.startsWith('data:')) {
      return photo.filename;
    }
    return `storage/${photo.filename}`;
  }

  // =========================================================================
  // Data Loading & Conversion
  // =========================================================================

  async function loadMetadataCSV() {
    try {
      const response = await fetch('metadata.csv?t=' + Date.now());
      if (!response.ok) {
        throw new Error(`Failed to fetch metadata.csv: ${response.statusText}`);
      }
      const csvText = await response.text();
      processCSVData(csvText);
      showToast('Gallery database loaded from metadata.csv', 'success');
    } catch (err) {
      console.warn('Could not load metadata.csv directly (common when opening via file:// protocol). Loading fallback seed data.', err);
      loadFallbackSeedData();
    }
  }

  function processCSVData(csvText) {
    const rawData = parseCSV(csvText);
    const parsedPhotos = [];

    rawData.forEach(row => {
      if (!row.filename) return;

      const tagList = row.tags ? row.tags.split(';').map(t => t.trim()).filter(Boolean) : [];
      const colorList = row.tag_colors ? row.tag_colors.split(';').map(c => c.trim()).filter(Boolean) : [];

      tagList.forEach((tag, idx) => {
        const color = colorList[idx] || state.tagColors[tag] || DEFAULT_TAG_COLORS[idx % DEFAULT_TAG_COLORS.length];
        state.tagColors[tag] = color;
      });

      parsedPhotos.push({
        id: row.id || `img-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        filename: row.filename,
        title: row.title || row.filename,
        album: row.album || 'Uncategorized',
        isCover: String(row.is_cover).toLowerCase() === 'true',
        tags: tagList,
        dateAdded: row.date_added || new Date().toISOString().split('T')[0],
        description: row.description || '',
      });
    });

    state.photos = parsedPhotos;
    renderAll();
  }

  function loadFallbackSeedData() {
    const seed = [
      { id: 'img-001', filename: 'sunset_peaks.svg', title: 'Golden Summit Sunset', album: 'Alpine Escapes', is_cover: 'true', tags: 'Sunset;Mountain;Landscape', tag_colors: '#d0a35f;#7f9cc4;#8fb49a', date_added: '2026-11-01', description: 'Stunning golden hour light over snow-capped alpine peaks' },
      { id: 'img-002', filename: 'emerald_valley.svg', title: 'Emerald Valley River', album: 'Alpine Escapes', is_cover: 'false', tags: 'Nature;Forest;Water', tag_colors: '#8fb49a;#7ea38a;#6fb3b8', date_added: '2026-11-03', description: 'Lush green river valley winding through dense pine woods' },
      { id: 'img-003', filename: 'neon_metropolis.svg', title: 'Tokyo Cyber Boulevard', album: 'Urban Nights', is_cover: 'true', tags: 'City;Neon;Night', tag_colors: '#c48a8a;#a58fc4;#7f9cc4', date_added: '2026-11-05', description: 'Vibrant reflection of neon signs on wet asphalt street' },
      { id: 'img-004', filename: 'skyline_reflections.svg', title: 'Harbor Bridge & Skyline', album: 'Urban Nights', is_cover: 'false', tags: 'Architecture;Water;Night', tag_colors: '#7f9cc4;#6fb3b8;#8a8a8f', date_added: '2026-11-08', description: 'Downtown skyline glowing across the calm harbor bay' },
      { id: 'img-005', filename: 'desert_dunes.svg', title: 'Whispering Sand Dunes', album: 'Serene Deserts', is_cover: 'true', tags: 'Desert;Minimal;Sunset', tag_colors: '#c4896a;#d0a35f;#c8a97e', date_added: '2026-11-10', description: 'Rippling patterns formed by desert wind during twilight' },
      { id: 'img-006', filename: 'oasis_haven.svg', title: 'Palm Oasis Sanctuary', album: 'Serene Deserts', is_cover: 'false', tags: 'Nature;Water;Travel', tag_colors: '#7ea38a;#6fb3b8;#c9b46f', date_added: '2026-11-12', description: 'Hidden desert oasis surrounded by palm trees and fresh spring' },
      { id: 'img-007', filename: 'coastal_arch.svg', title: 'Azure Coastal Arch', album: 'Coastal Vistas', is_cover: 'true', tags: 'Coast;Ocean;Nature', tag_colors: '#6fb3b8;#7f9cc4;#8fb49a', date_added: '2026-11-14', description: 'Majestic sea cliff arch carved by Mediterranean waves' },
      { id: 'img-008', filename: 'aurora_fjord.svg', title: 'Arctic Aurora Borealis', album: 'Nordic Wonders', is_cover: 'true', tags: 'Aurora;Night;Fjord', tag_colors: '#8fb49a;#7ea38a;#6fb3b8', date_added: '2026-11-16', description: 'Luminescent emerald northern lights dancing over a quiet arctic fjord' },
    ];
    processCSVData(serializeCSV(seed));
  }

  // =========================================================================
  // Filtering & Sorting
  // =========================================================================

  function getFilteredPhotos() {
    let result = [...state.photos];

    // Filter by album if selected
    if (state.filterAlbum) {
      result = result.filter(p => p.album === state.filterAlbum);
    }

    // Filter by tags (must contain all active tags)
    if (state.selectedTags.size > 0) {
      result = result.filter(p => {
        return Array.from(state.selectedTags).every(tag => p.tags.includes(tag));
      });
    }

    // Filter by search query
    if (state.searchQuery.trim()) {
      const q = state.searchQuery.toLowerCase();
      result = result.filter(p => {
        return (
          p.title.toLowerCase().includes(q) ||
          p.album.toLowerCase().includes(q) ||
          (p.description && p.description.toLowerCase().includes(q)) ||
          p.tags.some(t => t.toLowerCase().includes(q)) ||
          p.filename.toLowerCase().includes(q)
        );
      });
    }

    // Sort
    result.sort((a, b) => {
      switch (state.sortOrder) {
        case 'date-asc':
          return (a.dateAdded || '').localeCompare(b.dateAdded || '');
        case 'title-asc':
          return a.title.localeCompare(b.title);
        case 'album-asc':
          return a.album.localeCompare(b.album);
        case 'date-desc':
        default:
          return (b.dateAdded || '').localeCompare(a.dateAdded || '');
      }
    });

    return result;
  }

  function getAlbumsSummary() {
    const albumsMap = new Map();

    state.photos.forEach(photo => {
      const albumName = photo.album || 'Uncategorized';
      if (!albumsMap.has(albumName)) {
        albumsMap.set(albumName, {
          title: albumName,
          photos: [],
          coverPhoto: null,
          tags: new Set(),
        });
      }
      const entry = albumsMap.get(albumName);
      entry.photos.push(photo);
      photo.tags.forEach(t => entry.tags.add(t));
      if (photo.isCover) {
        entry.coverPhoto = photo;
      }
    });

    // Default cover if none flagged
    albumsMap.forEach(entry => {
      if (!entry.coverPhoto && entry.photos.length > 0) {
        entry.coverPhoto = entry.photos[0];
      }
    });

    return Array.from(albumsMap.values());
  }

  // =========================================================================
  // Rendering
  // =========================================================================

  function renderAll() {
    renderStats();
    renderAlbumDropdown();
    renderTagFilters();
    renderHighlightAlbumPills();
    render3DCurvedCarousel();
    if (state.currentView === 'albums') {
      renderAlbumsView();
    } else {
      renderPhotosView();
    }
  }

  function renderStats() {
    const totalPhotosEl = document.getElementById('statTotalPhotos');
    const totalAlbumsEl = document.getElementById('statTotalAlbums');
    const totalTagsEl = document.getElementById('statTotalTags');

    const albums = getAlbumsSummary();
    const tagCount = Object.keys(state.tagColors).length;

    if (totalPhotosEl) totalPhotosEl.textContent = state.photos.length;
    if (totalAlbumsEl) totalAlbumsEl.textContent = albums.length;
    if (totalTagsEl) totalTagsEl.textContent = tagCount;
  }

  function renderAlbumDropdown() {
    const select = document.getElementById('albumFilterSelect');
    if (!select) return;

    const albums = getAlbumsSummary();
    const currentVal = state.filterAlbum || '';

    let html = '<option value="">All albums</option>';
    albums.forEach(album => {
      const isSelected = album.title === currentVal ? 'selected' : '';
      html += `<option value="${escapeHTML(album.title)}" ${isSelected}>${escapeHTML(album.title)} (${album.photos.length})</option>`;
    });
    select.innerHTML = html;
  }

  function renderTagFilters() {
    const container = document.getElementById('tagFilterContainer');
    if (!container) return;

    const allTags = Object.keys(state.tagColors).sort();
    if (allTags.length === 0) {
      container.innerHTML = '<span class="muted-note">No tags yet</span>';
      return;
    }

    container.innerHTML = allTags
      .map(tag => tagBadge(tag, { button: true, active: state.selectedTags.has(tag) }))
      .join('');

    // Attach click events to tag pills
    container.querySelectorAll('.tag-badge').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tag = btn.getAttribute('data-tag');
        if (state.selectedTags.has(tag)) {
          state.selectedTags.delete(tag);
        } else {
          state.selectedTags.add(tag);
        }
        renderTagFilters();
        if (state.currentView === 'albums') {
          switchView('photos');
        } else {
          renderPhotosView();
        }
      });
    });
  }

  function renderAlbumsView() {
    const container = document.getElementById('albumsGrid');
    const viewSection = document.getElementById('albumsViewSection');
    const photosSection = document.getElementById('photosViewSection');

    if (!container) return;

    viewSection.style.display = 'block';
    photosSection.style.display = 'none';

    const albums = getAlbumsSummary();

    let html = `
      <div class="create-album-card" id="btnOpenCreateAlbumCard" role="button" tabindex="0">
        <div class="create-album-icon">${icon('plus', 'icon-lg')}</div>
        <h4>New album</h4>
        <p>Give it a title, add images and choose a cover</p>
      </div>
    `;

    albums.forEach((album, i) => {
      const coverSrc = album.coverPhoto ? getImageSrc(album.coverPhoto) : '';
      const tagsBadges = Array.from(album.tags).slice(0, 3)
        .map(tag => tagBadge(tag, { size: 'tag-sm' }))
        .join('');
      const count = album.photos.length;

      html += `
        <article class="album-card" data-album="${escapeHTML(album.title)}" style="animation-delay:${Math.min(i, 8) * 60}ms">
          <div class="album-cover-wrapper">
            ${coverSrc ? `<img class="album-cover-img" src="${coverSrc}" alt="${escapeHTML(album.title)}" loading="lazy">` : ''}
            <span class="album-photo-count">${count} ${count === 1 ? 'Photograph' : 'Photographs'}</span>
            <span class="album-open-hint">${icon('arrow-right', 'icon-sm')}</span>
          </div>
          <div class="album-info">
            <span class="album-index">${String(i + 1).padStart(2, '0')}</span>
            <h3 class="album-title">${escapeHTML(album.title)}</h3>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:0.35rem; padding-top:0.45rem; border-top:1px solid var(--line); flex-wrap:wrap; gap:0.4rem;">
              <div class="album-tags-summary">${tagsBadges}</div>
              <div style="display:flex; gap:0.35rem;">
                <button type="button" class="btn btn-ghost btn-sm btn-edit-album" data-album="${escapeHTML(album.title)}" title="Edit album settings">
                  ${icon('edit', 'icon-sm')} Edit
                </button>
                <button type="button" class="btn btn-ghost btn-sm btn-feature-highlight" data-album="${escapeHTML(album.title)}" title="Showcase this album in Highlight section">
                  ${icon('star', 'icon-sm')} Highlight
                </button>
              </div>
            </div>
          </div>
        </article>
      `;
    });

    container.innerHTML = html;

    // Attach card clicks
    container.querySelectorAll('.album-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.btn-feature-highlight, .btn-edit-album')) return;
        const albumName = card.getAttribute('data-album');
        openAlbumPhotos(albumName);
      });
    });

    // Edit Album button
    container.querySelectorAll('.btn-edit-album').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const albumName = btn.getAttribute('data-album');
        openEditAlbumModal(albumName);
      });
    });

    // Feature in Highlight button
    container.querySelectorAll('.btn-feature-highlight').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const albumName = btn.getAttribute('data-album');
        setHighlightAlbum(albumName);
        const sec = document.getElementById('highlightSection');
        if (sec) sec.scrollIntoView({ behavior: 'smooth' });
      });
    });

    // Create Album button
    const createBtn = document.getElementById('btnOpenCreateAlbumCard');
    if (createBtn) {
      createBtn.addEventListener('click', () => openModal('createAlbumModal'));
    }
  }

  function renderPhotosView() {
    const container = document.getElementById('photosGrid');
    const viewSection = document.getElementById('albumsViewSection');
    const photosSection = document.getElementById('photosViewSection');
    const headerTitle = document.getElementById('photosViewTitle');
    const backBtn = document.getElementById('btnBackToAlbums');

    if (!container) return;

    viewSection.style.display = 'none';
    photosSection.style.display = 'block';

    if (state.filterAlbum) {
      headerTitle.textContent = state.filterAlbum;
      if (backBtn) backBtn.style.display = 'inline-flex';
    } else {
      headerTitle.textContent = 'All Photographs';
      if (backBtn) backBtn.style.display = 'none';
    }

    const filtered = getFilteredPhotos();

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">${icon('image', 'icon-lg')}</div>
          <h3>Nothing matches</h3>
          <p>Try a different search, album or combination of tags.</p>
          <button class="btn btn-secondary" id="btnClearFiltersBtn">Clear filters</button>
        </div>
      `;
      const clearBtn = document.getElementById('btnClearFiltersBtn');
      if (clearBtn) {
        clearBtn.addEventListener('click', () => {
          state.searchQuery = '';
          state.filterAlbum = null;
          state.selectedTags.clear();
          const searchInput = document.getElementById('searchInput');
          if (searchInput) searchInput.value = '';
          renderAll();
        });
      }
      return;
    }

    let html = '';
    filtered.forEach((photo, idx) => {
      const src = getImageSrc(photo);
      const isCover = photo.isCover;

      const tagBadges = photo.tags.map(tag => tagBadge(tag, { size: 'tag-sm' })).join('');
      const pid = escapeHTML(photo.id);

      html += `
        <article class="photo-card" data-id="${pid}" style="animation-delay:${Math.min(idx, 12) * 40}ms">
          <div class="photo-img-wrapper" data-index="${idx}">
            <img class="photo-img" src="${src}" alt="${escapeHTML(photo.title)}" loading="lazy">
            ${isCover ? `<span class="cover-indicator">${icon('star', 'icon-sm')} Cover</span>` : ''}
            <div class="photo-quick-actions">
              <button class="photo-action-btn btn-quick-view" title="View full size" aria-label="View full size" data-index="${idx}">${icon('expand', 'icon-sm')}</button>
              <button class="photo-action-btn btn-edit-photo" title="Edit details" aria-label="Edit details" data-id="${pid}">${icon('edit', 'icon-sm')}</button>
              <button class="photo-action-btn btn-make-cover" title="${isCover ? 'Album cover' : 'Set as album cover'}" aria-label="Set as album cover" data-id="${pid}">${icon('star', 'icon-sm')}</button>
              <button class="photo-action-btn is-danger btn-delete-photo" title="Delete photograph" aria-label="Delete photograph" data-id="${pid}">${icon('trash', 'icon-sm')}</button>
            </div>
          </div>
          <div class="photo-details">
            <div class="photo-meta-row">
              <span class="photo-album-tag" title="${escapeHTML(photo.album)}">${escapeHTML(photo.album)}</span>
              <span>${escapeHTML(formatDate(photo.dateAdded))}</span>
            </div>
            <h4 class="photo-title" title="${escapeHTML(photo.title)}">${escapeHTML(photo.title)}</h4>
            <div class="photo-tags-container">${tagBadges}</div>
          </div>
        </article>
      `;
    });

    container.innerHTML = html;

    // Attach Lightbox triggers
    container.querySelectorAll('.photo-img-wrapper').forEach(wrapper => {
      wrapper.addEventListener('click', (e) => {
        if (e.target.closest('.photo-quick-actions')) return;
        const index = parseInt(wrapper.getAttribute('data-index'), 10);
        openLightbox(index);
      });
    });

    container.querySelectorAll('.btn-quick-view').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const index = parseInt(btn.getAttribute('data-index'), 10);
        openLightbox(index);
      });
    });

    // Edit photo button
    container.querySelectorAll('.btn-edit-photo').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        openEditPhotoModal(id);
      });
    });

    // Make Cover button
    container.querySelectorAll('.btn-make-cover').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        setPhotoAsAlbumCover(id);
      });
    });

    // Delete photo button
    container.querySelectorAll('.btn-delete-photo').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        deletePhoto(id);
      });
    });
  }

  function openAlbumPhotos(albumName) {
    state.filterAlbum = albumName;
    const albumSelect = document.getElementById('albumFilterSelect');
    if (albumSelect) albumSelect.value = albumName;
    switchView('photos');
  }

  function switchView(viewName) {
    state.currentView = viewName;
    const tabAlbums = document.getElementById('tabAlbums');
    const tabPhotos = document.getElementById('tabPhotos');

    if (viewName === 'albums') {
      state.filterAlbum = null;
      const albumSelect = document.getElementById('albumFilterSelect');
      if (albumSelect) albumSelect.value = '';
      if (tabAlbums) tabAlbums.classList.add('active');
      if (tabPhotos) tabPhotos.classList.remove('active');
      renderAlbumsView();
    } else {
      if (tabPhotos) tabPhotos.classList.add('active');
      if (tabAlbums) tabAlbums.classList.remove('active');
      renderPhotosView();
    }
  }

  // =========================================================================
  // Photo Operations (Cover, Delete, Add)
  // =========================================================================

  function setPhotoAsAlbumCover(photoId) {
    const photo = state.photos.find(p => p.id === photoId);
    if (!photo) return;

    // Unset current album cover for this album
    state.photos.forEach(p => {
      if (p.album === photo.album) {
        p.isCover = (p.id === photoId);
      }
    });

    showToast(`Set "${photo.title}" as cover for "${photo.album}"`, 'success');
    renderAll();
  }

  function deletePhoto(photoId) {
    const photo = state.photos.find(p => p.id === photoId);
    if (!photo) return;

    if (!confirm(`Are you sure you want to remove "${photo.title}" from the gallery?`)) {
      return;
    }

    state.photos = state.photos.filter(p => p.id !== photoId);
    // Also remove from newlyAddedFiles if present
    state.newlyAddedFiles = state.newlyAddedFiles.filter(item => item.name !== photo.filename);
    
    // Close lightbox or modal if open
    closeLightbox();
    closeModal('editPhotoModal');

    showToast(`Removed "${photo.title}" from gallery. Remember to export updated CSV!`, 'info');
    renderAll();
  }

  // =========================================================================
  // Edit Modals: Full Photo & Album CRUD Management
  // =========================================================================

  let currentEditPhotoTags = [];

  function openEditPhotoModal(photoId) {
    const photo = state.photos.find(p => p.id === photoId);
    if (!photo) return;

    const idInput = document.getElementById('editPhotoId');
    const titleInput = document.getElementById('editPhotoTitle');
    const albumSelect = document.getElementById('editPhotoAlbumSelect');
    const newAlbumGroup = document.getElementById('editPhotoNewAlbumGroup');
    const newAlbumName = document.getElementById('editPhotoNewAlbumName');
    const isCoverCheck = document.getElementById('editPhotoIsCover');
    const descInput = document.getElementById('editPhotoDescription');
    const filenameEl = document.getElementById('editPhotoFilename');
    const dateEl = document.getElementById('editPhotoDate');

    if (idInput) idInput.value = photo.id;
    if (titleInput) titleInput.value = photo.title || '';
    if (descInput) descInput.value = photo.description || '';
    if (isCoverCheck) isCoverCheck.checked = Boolean(photo.isCover);
    if (filenameEl) filenameEl.textContent = 'storage/' + photo.filename;
    if (dateEl) dateEl.textContent = formatDate(photo.dateAdded);

    // Populate album select dropdown
    if (albumSelect) {
      const albums = getAlbumsSummary();
      let optHtml = '';
      let found = false;
      albums.forEach(a => {
        if (a.title === photo.album) found = true;
        optHtml += `<option value="${escapeHTML(a.title)}">${escapeHTML(a.title)}</option>`;
      });
      if (!found && photo.album) {
        optHtml = `<option value="${escapeHTML(photo.album)}">${escapeHTML(photo.album)}</option>` + optHtml;
      }
      optHtml += '<option value="__NEW__">+ Create new album…</option>';
      albumSelect.innerHTML = optHtml;
      albumSelect.value = photo.album || (albums[0] ? albums[0].title : 'General');
    }

    if (newAlbumGroup) newAlbumGroup.style.display = 'none';
    if (newAlbumName) newAlbumName.value = '';

    // Initialize tags for this photo
    currentEditPhotoTags = [...photo.tags];
    renderEditPhotoTags();

    openModal('editPhotoModal');
  }

  function renderEditPhotoTags() {
    const container = document.getElementById('editPhotoTagsBadges');
    if (!container) return;

    if (currentEditPhotoTags.length === 0) {
      container.innerHTML = '<span class="muted-note" style="color:var(--text-3); font-size:0.75rem;">No tags assigned yet.</span>';
      return;
    }

    container.innerHTML = currentEditPhotoTags
      .map((t, idx) => tagBadge(t, { removable: idx }))
      .join('');

    container.querySelectorAll('.remove-staged-tag').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-index'), 10);
        currentEditPhotoTags.splice(idx, 1);
        renderEditPhotoTags();
      });
    });
  }

  function openEditAlbumModal(albumName) {
    if (!albumName) return;

    const origTitleInput = document.getElementById('editAlbumOriginalTitle');
    const titleInput = document.getElementById('editAlbumTitleInput');
    const coverSelect = document.getElementById('editAlbumCoverSelect');

    if (origTitleInput) origTitleInput.value = albumName;
    if (titleInput) titleInput.value = albumName;

    const albumPhotos = state.photos.filter(p => p.album === albumName);

    if (coverSelect) {
      if (albumPhotos.length === 0) {
        coverSelect.innerHTML = '<option value="">(No photographs in this album)</option>';
      } else {
        let optHtml = '';
        albumPhotos.forEach(p => {
          const isCover = p.isCover ? ' (Current Cover)' : '';
          optHtml += `<option value="${escapeHTML(p.id)}" ${p.isCover ? 'selected' : ''}>${escapeHTML(p.title || p.filename)}${isCover}</option>`;
        });
        coverSelect.innerHTML = optHtml;
      }
    }

    openModal('editAlbumModal');
  }

  function deleteAlbum(albumName) {
    if (!albumName) return;

    const albumPhotos = state.photos.filter(p => p.album === albumName);
    const msg = `Are you sure you want to delete the album “${albumName}”?\n\nAll ${albumPhotos.length} photograph(s) in this album will be safely reassigned to “General”.`;
    if (!confirm(msg)) return;

    // Reassign photos to 'General'
    state.photos.forEach(p => {
      if (p.album === albumName) {
        p.album = 'General';
      }
    });

    if (state.filterAlbum === albumName) {
      state.filterAlbum = null;
    }
    if (state.highlightAlbum === albumName) {
      state.highlightAlbum = '';
    }

    closeModal('editAlbumModal');
    showToast(`Deleted album “${albumName}”. Photographs reassigned to General.`, 'info');
    renderAll();
  }

  function initEditModals() {
    // 1. Edit Photo Form submit
    const editPhotoForm = document.getElementById('editPhotoForm');
    if (editPhotoForm) {
      editPhotoForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const id = document.getElementById('editPhotoId').value;
        const photo = state.photos.find(p => p.id === id);
        if (!photo) return;

        const newTitle = document.getElementById('editPhotoTitle').value.trim();
        let targetAlbum = document.getElementById('editPhotoAlbumSelect').value;
        if (targetAlbum === '__NEW__') {
          const customAlbum = document.getElementById('editPhotoNewAlbumName').value.trim();
          if (!customAlbum) {
            alert('Please enter a title for the new album.');
            return;
          }
          targetAlbum = customAlbum;
        }

        const isCover = document.getElementById('editPhotoIsCover').checked;
        const desc = document.getElementById('editPhotoDescription').value.trim();

        photo.title = newTitle || photo.title;
        photo.album = targetAlbum || photo.album || 'General';
        photo.description = desc;
        photo.tags = [...currentEditPhotoTags];

        if (isCover) {
          state.photos.forEach(p => {
            if (p.album === photo.album) {
              p.isCover = (p.id === photo.id);
            }
          });
        } else {
          photo.isCover = false;
        }

        closeModal('editPhotoModal');
        showToast(`Saved changes to “${photo.title}”.`, 'success');
        renderAll();
      });
    }

    // Delete photo from edit modal button
    const btnDeletePhoto = document.getElementById('btnDeletePhotoFromModal');
    if (btnDeletePhoto) {
      btnDeletePhoto.addEventListener('click', () => {
        const id = document.getElementById('editPhotoId').value;
        deletePhoto(id);
      });
    }

    // Edit Photo Album select __NEW__ toggle
    const editPhotoAlbumSelect = document.getElementById('editPhotoAlbumSelect');
    const editPhotoNewAlbumGroup = document.getElementById('editPhotoNewAlbumGroup');
    const editPhotoNewAlbumName = document.getElementById('editPhotoNewAlbumName');
    if (editPhotoAlbumSelect && editPhotoNewAlbumGroup) {
      editPhotoAlbumSelect.addEventListener('change', () => {
        if (editPhotoAlbumSelect.value === '__NEW__') {
          editPhotoNewAlbumGroup.style.display = 'block';
          if (editPhotoNewAlbumName) editPhotoNewAlbumName.focus();
        } else {
          editPhotoNewAlbumGroup.style.display = 'none';
        }
      });
    }

    // Edit Photo Tag Input and Color Presets
    const editTagInput = document.getElementById('editPhotoTagInput');
    const editTagColor = document.getElementById('editPhotoTagColor');
    const btnAddEditTag = document.getElementById('btnAddEditPhotoTag');
    const editColorSwatches = document.getElementById('editPhotoColorSwatches');

    function addEditPhotoTag() {
      if (!editTagInput) return;
      const val = editTagInput.value.trim();
      const color = editTagColor ? editTagColor.value : '#c8a97e';
      if (!val) return;

      if (!currentEditPhotoTags.some(t => t.toLowerCase() === val.toLowerCase())) {
        currentEditPhotoTags.push(val);
        state.tagColors[val] = color;
      }
      editTagInput.value = '';
      renderEditPhotoTags();
    }

    if (btnAddEditTag) btnAddEditTag.addEventListener('click', addEditPhotoTag);
    if (editTagInput) {
      editTagInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          addEditPhotoTag();
        }
      });
    }

    if (editColorSwatches && editTagColor) {
      editColorSwatches.innerHTML = DEFAULT_TAG_COLORS.map(c => `
        <div class="color-swatch" style="background-color:${c}" data-color="${c}" title="${c}"></div>
      `).join('');

      function syncEditSwatches() {
        const current = editTagColor.value.toLowerCase();
        editColorSwatches.querySelectorAll('.color-swatch').forEach(s => {
          s.classList.toggle('active', s.getAttribute('data-color').toLowerCase() === current);
        });
      }

      editColorSwatches.querySelectorAll('.color-swatch').forEach(swatch => {
        swatch.addEventListener('click', () => {
          editTagColor.value = swatch.getAttribute('data-color');
          syncEditSwatches();
        });
      });

      editTagColor.addEventListener('input', syncEditSwatches);
      syncEditSwatches();
    }

    // 2. Edit Album Form submit
    const editAlbumForm = document.getElementById('editAlbumForm');
    if (editAlbumForm) {
      editAlbumForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const origTitle = document.getElementById('editAlbumOriginalTitle').value;
        const newTitle = document.getElementById('editAlbumTitleInput').value.trim();
        if (!newTitle) {
          alert('Album title cannot be empty.');
          return;
        }

        const selectedCoverId = document.getElementById('editAlbumCoverSelect').value;

        // Update album title across all photos
        if (newTitle !== origTitle) {
          state.photos.forEach(p => {
            if (p.album === origTitle) {
              p.album = newTitle;
            }
          });
          if (state.filterAlbum === origTitle) state.filterAlbum = newTitle;
          if (state.highlightAlbum === origTitle) state.highlightAlbum = newTitle;
        }

        // Update cover photo
        if (selectedCoverId) {
          state.photos.forEach(p => {
            if (p.album === newTitle) {
              p.isCover = (p.id === selectedCoverId);
            }
          });
        }

        closeModal('editAlbumModal');
        showToast(`Updated album “${newTitle}”.`, 'success');
        renderAll();
      });
    }

    // Delete album from edit modal button
    const btnDeleteAlbum = document.getElementById('btnDeleteAlbumFromModal');
    if (btnDeleteAlbum) {
      btnDeleteAlbum.addEventListener('click', () => {
        const origTitle = document.getElementById('editAlbumOriginalTitle').value;
        deleteAlbum(origTitle);
      });
    }
  }

  // =========================================================================
  // Bulk Upload Workflow
  // =========================================================================

  function initBulkUploadModal() {
    const dropzone = document.getElementById('uploadDropzone');
    const fileInput = document.getElementById('bulkFileInput');
    const stagedList = document.getElementById('stagedFilesList');
    const albumSelect = document.getElementById('uploadAlbumSelect');
    const newAlbumGroup = document.getElementById('newAlbumInputGroup');
    const newAlbumInput = document.getElementById('uploadNewAlbumName');
    const tagInput = document.getElementById('uploadTagInput');
    const tagColorInput = document.getElementById('uploadTagColor');
    const btnAddTag = document.getElementById('btnAddStagedTag');
    const stagedTagsContainer = document.getElementById('stagedTagsBadges');
    const btnSaveUpload = document.getElementById('btnSubmitUpload');
    const colorSwatchesContainer = document.getElementById('uploadColorSwatches');

    // Populate album select
    function populateUploadAlbums() {
      const albums = getAlbumsSummary();
      let html = '<option value="">Choose an album…</option>';
      albums.forEach(a => {
        html += `<option value="${escapeHTML(a.title)}">${escapeHTML(a.title)}</option>`;
      });
      html += '<option value="__NEW__">New album…</option>';
      albumSelect.innerHTML = html;
    }

    albumSelect.addEventListener('change', () => {
      if (albumSelect.value === '__NEW__') {
        newAlbumGroup.style.display = 'flex';
        newAlbumInput.focus();
      } else {
        newAlbumGroup.style.display = 'none';
      }
    });

    // Populate color preset swatches
    function syncSwatches() {
      if (!colorSwatchesContainer) return;
      const current = tagColorInput.value.toLowerCase();
      colorSwatchesContainer.querySelectorAll('.color-swatch').forEach(s => {
        s.classList.toggle('active', s.getAttribute('data-color').toLowerCase() === current);
      });
    }

    if (colorSwatchesContainer) {
      colorSwatchesContainer.innerHTML = DEFAULT_TAG_COLORS.map(c => `
        <div class="color-swatch" style="background-color:${c}" data-color="${c}" title="${c}"></div>
      `).join('');

      colorSwatchesContainer.querySelectorAll('.color-swatch').forEach(swatch => {
        swatch.addEventListener('click', () => {
          tagColorInput.value = swatch.getAttribute('data-color');
          syncSwatches();
        });
      });
      tagColorInput.addEventListener('input', syncSwatches);
      syncSwatches();
    }

    // Drag and drop handlers
    dropzone.addEventListener('click', () => fileInput.click());

    ['dragenter', 'dragover'].forEach(eventName => {
      dropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
      });
    });

    ['dragleave', 'drop'].forEach(eventName => {
      dropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
      });
    });

    dropzone.addEventListener('drop', (e) => {
      const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
      handleFilesSelected(files);
    });

    fileInput.addEventListener('change', (e) => {
      const files = Array.from(e.target.files);
      handleFilesSelected(files);
      fileInput.value = ''; // reset
    });

    function handleFilesSelected(files) {
      if (!files.length) return;

      files.forEach(file => {
        const previewUrl = URL.createObjectURL(file);
        // Format clean title from filename
        const cleanTitle = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');

        state.stagedUploadFiles.push({
          file: file,
          previewUrl: previewUrl,
          title: cleanTitle.charAt(0).toUpperCase() + cleanTitle.slice(1),
          name: file.name
        });
      });

      renderStagedFiles();
    }

    function renderStagedFiles() {
      if (state.stagedUploadFiles.length === 0) {
        stagedList.innerHTML = '<span class="muted-note">No images selected yet.</span>';
        return;
      }

      let html = '';
      state.stagedUploadFiles.forEach((item, idx) => {
        html += `
          <div class="staged-item">
            <button type="button" class="staged-remove-btn" data-index="${idx}" title="Remove" aria-label="Remove">${icon('close', 'icon-sm')}</button>
            <img class="staged-thumb" src="${item.previewUrl}" alt="Thumbnail">
            <div class="staged-name" title="${escapeHTML(item.name)}">${escapeHTML(item.name)}</div>
          </div>
        `;
      });
      stagedList.innerHTML = html;

      stagedList.querySelectorAll('.staged-remove-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const idx = parseInt(btn.getAttribute('data-index'), 10);
          state.stagedUploadFiles.splice(idx, 1);
          renderStagedFiles();
        });
      });
    }

    // Add Staged Tag
    function addStagedTag() {
      const tagName = tagInput.value.trim();
      const tagColor = tagColorInput.value;
      if (!tagName) return;

      if (!state.stagedTags.some(t => t.name.toLowerCase() === tagName.toLowerCase())) {
        state.stagedTags.push({ name: tagName, color: tagColor });
        state.tagColors[tagName] = tagColor;
      }

      tagInput.value = '';
      renderStagedTags();
    }

    btnAddTag.addEventListener('click', addStagedTag);
    tagInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addStagedTag();
      }
    });

    function renderStagedTags() {
      if (state.stagedTags.length === 0) {
        stagedTagsContainer.innerHTML = '<span class="muted-note">No tags added.</span>';
        return;
      }

      stagedTagsContainer.innerHTML = state.stagedTags
        .map((t, idx) => tagBadge(t.name, { removable: idx }))
        .join('');

      stagedTagsContainer.querySelectorAll('.remove-staged-tag').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.getAttribute('data-index'), 10);
          state.stagedTags.splice(idx, 1);
          renderStagedTags();
        });
      });
    }

    // Submit Upload
    btnSaveUpload.addEventListener('click', () => {
      if (state.stagedUploadFiles.length === 0) {
        alert('Please select at least one picture to upload.');
        return;
      }

      let albumName = albumSelect.value;
      if (albumName === '__NEW__') {
        albumName = newAlbumInput.value.trim();
        if (!albumName) {
          alert('Please enter a name for the new album.');
          return;
        }
      } else if (!albumName) {
        albumName = 'General';
      }

      const isSetCover = document.getElementById('uploadSetCover').checked;
      const tagsList = state.stagedTags.map(t => t.name);

      const today = new Date().toISOString().split('T')[0];

      // Add to state
      state.stagedUploadFiles.forEach((item, index) => {
        const newPhoto = {
          id: `img-${Date.now()}-${index}`,
          filename: item.name,
          title: item.title,
          album: albumName,
          isCover: isSetCover && index === 0,
          tags: [...tagsList],
          dateAdded: today,
          description: '',
          blobUrl: item.previewUrl,
          file: item.file
        };

        state.photos.unshift(newPhoto);
        state.newlyAddedFiles.push(item);
      });

      const addedCount = state.stagedUploadFiles.length;
      showToast(`Added ${addedCount} ${addedCount === 1 ? 'image' : 'images'} to “${albumName}”.`, 'success');

      // Clear staging (state and DOM)
      state.stagedUploadFiles = [];
      state.stagedTags = [];
      newAlbumInput.value = '';
      albumSelect.value = '';
      newAlbumGroup.style.display = 'none';
      renderStagedFiles();
      renderStagedTags();

      closeModal('bulkUploadModal');
      renderAll();

      // Switch to photos view of this album
      openAlbumPhotos(albumName);

      // Prompt to download updated CSV
      setTimeout(() => {
        showToast('Open Database to download the updated metadata.csv for GitHub Pages.', 'info');
      }, 1500);
    });

    // Expose populate helper
    window.refreshUploadModalAlbums = populateUploadAlbums;
  }

  // =========================================================================
  // Lightbox Viewer
  // =========================================================================

  function openLightbox(index) {
    const photos = getFilteredPhotos();
    if (index < 0 || index >= photos.length) return;

    state.lightboxIndex = index;
    const photo = photos[index];

    const backdrop = document.getElementById('lightboxBackdrop');
    const img = document.getElementById('lightboxImg');
    const title = document.getElementById('lightboxTitle');
    const metaInfo = document.getElementById('lightboxMetaInfo');
    const btnMakeCover = document.getElementById('btnLightboxMakeCover');
    const btnDownload = document.getElementById('btnLightboxDownload');
    const btnLightboxEdit = document.getElementById('btnLightboxEdit');

    const src = getImageSrc(photo);
    img.src = src;
    img.alt = photo.title;
    title.textContent = photo.title;

    const tagBadges = photo.tags.map(tag => tagBadge(tag)).join('');

    metaInfo.innerHTML = `
      <div class="lightbox-meta-line">
        <span class="photo-album-tag">${escapeHTML(photo.album)}</span>
        <span>${escapeHTML(formatDate(photo.dateAdded))}</span>
        <span class="mono">storage/${escapeHTML(photo.filename)}</span>
      </div>
      ${tagBadges ? `<div class="photo-tags-container">${tagBadges}</div>` : ''}
    `;

    // Restart the image entrance animation on navigation
    img.style.animation = 'none';
    void img.offsetWidth;
    img.style.animation = '';

    if (btnLightboxEdit) {
      btnLightboxEdit.onclick = () => {
        const pId = photo.id;
        closeLightbox();
        openEditPhotoModal(pId);
      };
    }

    btnMakeCover.onclick = () => {
      setPhotoAsAlbumCover(photo.id);
      openLightbox(state.lightboxIndex); // refresh details
    };

    btnDownload.onclick = () => {
      downloadUrl(src, photo.filename);
    };

    backdrop.classList.add('open');
  }

  function closeLightbox() {
    const backdrop = document.getElementById('lightboxBackdrop');
    if (backdrop) backdrop.classList.remove('open');
    state.lightboxIndex = -1;
  }

  function nextLightbox() {
    const photos = getFilteredPhotos();
    if (photos.length === 0) return;
    state.lightboxIndex = (state.lightboxIndex + 1) % photos.length;
    openLightbox(state.lightboxIndex);
  }

  function prevLightbox() {
    const photos = getFilteredPhotos();
    if (photos.length === 0) return;
    state.lightboxIndex = (state.lightboxIndex - 1 + photos.length) % photos.length;
    openLightbox(state.lightboxIndex);
  }

  // =========================================================================
  // Database & CSV Export / Import
  // =========================================================================

  function exportMetadataCSV() {
    const data = state.photos.map(p => {
      const colors = p.tags.map(t => state.tagColors[t] || '#3b82f6').join(';');
      return {
        id: p.id,
        filename: p.filename,
        title: p.title,
        album: p.album,
        is_cover: p.isCover ? 'true' : 'false',
        tags: p.tags.join(';'),
        tag_colors: colors,
        date_added: p.dateAdded,
        description: p.description || ''
      };
    });

    const csvContent = serializeCSV(data);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    downloadUrl(url, 'metadata.csv');
    URL.revokeObjectURL(url);
    showToast('Downloaded metadata.csv! Replace the file in your repository.', 'success');
  }

  function downloadUrl(url, filename) {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function downloadStagedMediaFiles() {
    if (state.newlyAddedFiles.length === 0) {
      alert('No new pictures were uploaded in this session. All existing images are already located in the storage/ directory.');
      return;
    }

    state.newlyAddedFiles.forEach(item => {
      downloadUrl(item.previewUrl, item.name);
    });

    showToast(`Downloading ${state.newlyAddedFiles.length} image(s). Place them in your "storage" folder!`, 'success');
  }

  function renderCSVModalTable() {
    const tableBody = document.getElementById('csvTableBody');
    if (!tableBody) return;

    let html = '';
    state.photos.forEach(p => {
      html += `
        <tr>
          <td>${escapeHTML(p.id)}</td>
          <td><strong>${escapeHTML(p.filename)}</strong></td>
          <td>${escapeHTML(p.title)}</td>
          <td>${escapeHTML(p.album)}</td>
          <td>${p.isCover ? 'true' : 'false'}</td>
          <td>${escapeHTML(p.tags.join('; '))}</td>
          <td>${escapeHTML(p.dateAdded)}</td>
        </tr>
      `;
    });

    tableBody.innerHTML = html;
  }

  // =========================================================================
  // Modal Utilities
  // =========================================================================

  function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    if (modalId === 'bulkUploadModal' && window.refreshUploadModalAlbums) {
      window.refreshUploadModalAlbums();
    }
    if (modalId === 'csvManagerModal') {
      renderCSVModalTable();
    }
    modal.classList.add('open');
  }

  function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('open');
  }

  // Helper escape HTML
  function escapeHTML(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // =========================================================================
  // Highlight Section: Interactive Album Showcase & 3D Curved Carousel
  // =========================================================================

  const carouselState = {
    currentAngle: 0,
    targetAngle: 0,
    isDragging: false,
    startX: 0,
    startAngle: 0,
    lastX: 0,
    velX: 0,
    isHovered: false,
    tiltX: 0,
    tiltY: 0,
    targetTiltX: 0,
    targetTiltY: 0,
    rafId: null,
  };

  function renderHighlightAlbumPills() {
    const container = document.getElementById('highlightAlbumPills');
    if (!container) return;

    const albums = getAlbumsSummary();
    const isAllActive = !state.highlightAlbum;

    let html = `
      <button type="button" class="highlight-album-pill ${isAllActive ? 'active' : ''}" data-album="">
        All Photographs (${state.photos.length})
      </button>
    `;

    albums.forEach(album => {
      const isActive = state.highlightAlbum === album.title;
      html += `
        <button type="button" class="highlight-album-pill ${isActive ? 'active' : ''}" data-album="${escapeHTML(album.title)}">
          ${escapeHTML(album.title)} (${album.photos.length})
        </button>
      `;
    });

    container.innerHTML = html;

    container.querySelectorAll('.highlight-album-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        const album = btn.getAttribute('data-album');
        setHighlightAlbum(album);
      });
    });
  }

  function setHighlightAlbum(albumName) {
    state.highlightAlbum = albumName || '';
    renderHighlightAlbumPills();
    render3DCurvedCarousel();
    showToast(
      albumName
        ? `Showcasing “${albumName}” in Highlight`
        : 'Showcasing all photographs in Highlight',
      'info'
    );
  }

  function render3DCurvedCarousel() {
    const stage = document.getElementById('carousel3DStage');
    const notice = document.getElementById('highlightAlbumNotice');
    if (!stage) return;

    // Filter photos by selected highlight album if one is chosen
    const pool = state.highlightAlbum
      ? state.photos.filter(p => p.album === state.highlightAlbum)
      : state.photos;

    if (notice) {
      if (state.highlightAlbum) {
        notice.textContent = `Showcasing: ${state.highlightAlbum} (${pool.length} ${pool.length === 1 ? 'photograph' : 'photographs'})`;
      } else {
        notice.textContent = `Showcasing all photographs (${state.photos.length})`;
      }
    }

    if (pool.length === 0) {
      stage.innerHTML = `<span class="muted-note" style="color:var(--text-3); font-size:0.85rem;">No photographs found in “${escapeHTML(state.highlightAlbum)}”</span>`;
      return;
    }

    // Ensure we have at least 8 items for a rich curved arc, repeating if needed
    let showcaseItems = [...pool];
    while (showcaseItems.length < 8) {
      showcaseItems = showcaseItems.concat(pool);
    }
    showcaseItems = showcaseItems.slice(0, 14);

    let html = '';
    showcaseItems.forEach((photo, idx) => {
      const src = getImageSrc(photo);
      html += `
        <div class="carousel-3d-card" data-carousel-idx="${idx}" data-photo-id="${escapeHTML(photo.id)}">
          <img src="${src}" alt="${escapeHTML(photo.title)}" loading="lazy">
          <div class="carousel-3d-card-overlay">
            <span class="carousel-3d-card-title">${escapeHTML(photo.title)}</span>
          </div>
        </div>
      `;
    });

    stage.innerHTML = html;

    // Card click events
    stage.querySelectorAll('.carousel-3d-card').forEach(card => {
      card.addEventListener('click', () => {
        const cardIdx = parseInt(card.getAttribute('data-carousel-idx'), 10);
        const photoId = card.getAttribute('data-photo-id');
        handleCarouselCardClick(cardIdx, photoId);
      });
    });
  }

  function handleCarouselCardClick(cardIdx, photoId) {
    const stage = document.getElementById('carousel3DStage');
    if (!stage) return;
    const cards = stage.querySelectorAll('.carousel-3d-card');
    const total = cards.length;
    if (total === 0) return;

    const angleStep = (15.5 * Math.PI) / 180;
    const cardTheta = cardIdx * angleStep;
    let diff = (cardTheta - carouselState.targetAngle) % (2 * Math.PI);
    if (diff > Math.PI) diff -= 2 * Math.PI;
    if (diff < -Math.PI) diff += 2 * Math.PI;

    // If card is already near center, open full Lightbox view
    if (Math.abs(diff) < 0.12) {
      const filtered = getFilteredPhotos();
      const pIdx = filtered.findIndex(p => p.id === photoId);
      if (pIdx !== -1) {
        openLightbox(pIdx);
      } else {
        const anyIdx = state.photos.findIndex(p => p.id === photoId);
        if (anyIdx !== -1) openLightbox(anyIdx);
      }
    } else {
      // Smoothly rotate clicked card into center
      carouselState.targetAngle += diff;
    }
  }

  function init3DCurvedCarousel() {
    const viewport = document.getElementById('carousel3DViewport');
    const stage = document.getElementById('carousel3DStage');
    const prevBtn = document.getElementById('btnCarouselPrev');
    const nextBtn = document.getElementById('btnCarouselNext');

    if (!viewport || !stage) return;

    const angleStep = (15.5 * Math.PI) / 180;

    // Nav buttons
    if (prevBtn) {
      prevBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        carouselState.targetAngle -= angleStep;
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        carouselState.targetAngle += angleStep;
      });
    }

    // Hover state to pause auto-drift
    viewport.addEventListener('mouseenter', () => {
      carouselState.isHovered = true;
    });
    viewport.addEventListener('mouseleave', () => {
      carouselState.isHovered = false;
      carouselState.targetTiltX = 0;
      carouselState.targetTiltY = 0;
    });

    // Mouse parallax tilt
    viewport.addEventListener('mousemove', (e) => {
      if (carouselState.isDragging) return;
      const rect = viewport.getBoundingClientRect();
      const normX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const normY = ((e.clientY - rect.top) / rect.height) * 2 - 1;
      carouselState.targetTiltY = normX * 10;
      carouselState.targetTiltX = -normY * 6;
    });

    // Drag / Touch handlers
    viewport.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.carousel-nav-btn')) return;
      carouselState.isDragging = true;
      carouselState.startX = e.clientX;
      carouselState.startAngle = carouselState.targetAngle;
      carouselState.lastX = e.clientX;
      carouselState.velX = 0;
      viewport.setPointerCapture(e.pointerId);
    });

    viewport.addEventListener('pointermove', (e) => {
      if (!carouselState.isDragging) return;
      const deltaX = e.clientX - carouselState.startX;
      const currentW = viewport.getBoundingClientRect().width;
      const radius = Math.max(440, currentW * 0.58);
      carouselState.targetAngle = carouselState.startAngle - (deltaX / radius) * 1.5;
      carouselState.velX = e.clientX - carouselState.lastX;
      carouselState.lastX = e.clientX;
    });

    function endDrag() {
      if (!carouselState.isDragging) return;
      carouselState.isDragging = false;
      const currentW = viewport.getBoundingClientRect().width;
      const radius = Math.max(440, currentW * 0.58);
      carouselState.targetAngle -= (carouselState.velX / radius) * 2.8;
    }

    viewport.addEventListener('pointerup', endDrag);
    viewport.addEventListener('pointercancel', endDrag);

    // Wheel horizontal scrolling support
    viewport.addEventListener('wheel', (e) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) {
        e.preventDefault();
        const delta = e.deltaX !== 0 ? e.deltaX : e.deltaY;
        carouselState.targetAngle += (delta / 700) * angleStep;
      }
    }, { passive: false });

    // 3D Animation Loop
    function update3DCarousel() {
      // Gentle auto-drift when idle
      if (!carouselState.isHovered && !carouselState.isDragging) {
        carouselState.targetAngle += 0.001;
      }

      // Interpolation
      carouselState.currentAngle += (carouselState.targetAngle - carouselState.currentAngle) * 0.1;
      carouselState.tiltX += (carouselState.targetTiltX - carouselState.tiltX) * 0.08;
      carouselState.tiltY += (carouselState.targetTiltY - carouselState.tiltY) * 0.08;

      // Tilt stage
      stage.style.transform = `rotateX(${carouselState.tiltX.toFixed(2)}deg) rotateY(${carouselState.tiltY.toFixed(2)}deg)`;

      const cards = stage.querySelectorAll('.carousel-3d-card');
      const total = cards.length;

      if (total > 0) {
        const currentW = viewport.getBoundingClientRect().width;
        const radius = Math.max(440, currentW * 0.58);
        const maxVisibleAngle = Math.min(1.22, (currentW / radius) * 0.95);

        cards.forEach((card, idx) => {
          const cardTheta = idx * angleStep;
          let delta = (cardTheta - carouselState.currentAngle) % (2 * Math.PI);
          if (delta > Math.PI) delta -= 2 * Math.PI;
          if (delta < -Math.PI) delta += 2 * Math.PI;

          if (Math.abs(delta) <= maxVisibleAngle) {
            // Cylindrical concave geometry
            const x = Math.sin(delta) * radius;
            const z = (Math.cos(delta) - 1) * radius - (Math.pow(delta, 2) * 16);
            const rotY = -delta * (180 / Math.PI);
            // Subtle smiling bottom curve
            const y = Math.pow(Math.abs(delta), 1.5) * 34;
            const scale = Math.max(0.72, 1 - Math.abs(delta) * 0.15);
            const opacity = Math.max(0, 1 - Math.pow(Math.abs(delta) / maxVisibleAngle, 2.8));

            card.style.display = 'block';
            card.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, ${z.toFixed(1)}px) rotateY(${rotY.toFixed(1)}deg) scale(${scale.toFixed(3)})`;
            card.style.opacity = opacity.toFixed(3);
            card.style.zIndex = Math.round(1000 - Math.abs(delta) * 100);
          } else {
            card.style.display = 'none';
          }
        });
      }

      carouselState.rafId = requestAnimationFrame(update3DCarousel);
    }

    if (!carouselState.rafId) {
      carouselState.rafId = requestAnimationFrame(update3DCarousel);
    }
  }

  // =========================================================================
  // Card 3D Tilt & Dynamic Spotlight Sheen
  // =========================================================================

  function initCardTiltEffects() {
    function getCard(el) {
      return el.closest('.album-card, .photo-card');
    }

    document.addEventListener('mousemove', (e) => {
      const card = getCard(e.target);
      if (!card) return;

      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;

      // Gentle tactile 3D tilt
      const rotateX = ((y - centerY) / centerY) * -5;
      const rotateY = ((x - centerX) / centerX) * 5;

      card.style.transform = `perspective(1000px) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) translateZ(6px)`;

      // Dynamic sheen reflection
      let sheen = card.querySelector('.card-sheen');
      if (!sheen) {
        sheen = document.createElement('div');
        sheen.className = 'card-sheen';
        card.appendChild(sheen);
      }
      sheen.style.background = `radial-gradient(circle at ${x.toFixed(0)}px ${y.toFixed(0)}px, rgba(255, 255, 255, 0.18) 0%, transparent 60%)`;
      sheen.style.opacity = '1';
    });

    document.addEventListener('mouseout', (e) => {
      const card = getCard(e.target);
      if (!card) return;
      if (!card.contains(e.relatedTarget)) {
        card.style.transform = '';
        const sheen = card.querySelector('.card-sheen');
        if (sheen) sheen.style.opacity = '0';
      }
    });
  }

  // =========================================================================
  // Application Bootstrap & Event Listeners
  // =========================================================================

  function initApp() {
    // Top Tabs
    const tabAlbums = document.getElementById('tabAlbums');
    const tabPhotos = document.getElementById('tabPhotos');
    if (tabAlbums) tabAlbums.addEventListener('click', () => switchView('albums'));
    if (tabPhotos) tabPhotos.addEventListener('click', () => switchView('photos'));

    const brandHomeBtn = document.getElementById('brandHomeBtn');
    if (brandHomeBtn) {
      brandHomeBtn.addEventListener('click', () => {
        switchView('albums');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }

    // Keyboard access for the "New album" tile
    document.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.id === 'btnOpenCreateAlbumCard') {
        e.preventDefault();
        openModal('createAlbumModal');
      }
    });

    // Back to albums button
    const btnBackToAlbums = document.getElementById('btnBackToAlbums');
    if (btnBackToAlbums) {
      btnBackToAlbums.addEventListener('click', () => switchView('albums'));
    }

    // Search Input
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        state.searchQuery = e.target.value;
        if (state.currentView === 'albums') {
          switchView('photos');
        } else {
          renderPhotosView();
        }
      });
    }

    // Album Filter Select
    const albumFilterSelect = document.getElementById('albumFilterSelect');
    if (albumFilterSelect) {
      albumFilterSelect.addEventListener('change', (e) => {
        state.filterAlbum = e.target.value || null;
        if (state.currentView === 'albums') {
          switchView('photos');
        } else {
          renderPhotosView();
        }
      });
    }

    // Sort Select
    const sortSelect = document.getElementById('sortSelect');
    if (sortSelect) {
      sortSelect.addEventListener('change', (e) => {
        state.sortOrder = e.target.value;
        renderPhotosView();
      });
    }

    // Header Action Buttons
    const btnOpenUpload = document.getElementById('btnOpenBulkUpload');
    if (btnOpenUpload) {
      btnOpenUpload.addEventListener('click', () => openModal('bulkUploadModal'));
    }

    const btnOpenCSV = document.getElementById('btnOpenCSVModal');
    if (btnOpenCSV) {
      btnOpenCSV.addEventListener('click', () => openModal('csvManagerModal'));
    }

    const btnOpenGuide = document.getElementById('btnOpenGuideModal');
    if (btnOpenGuide) {
      btnOpenGuide.addEventListener('click', () => openModal('guideModal'));
    }

    // CSV Modal buttons
    const btnExportCSV = document.getElementById('btnExportCSV');
    if (btnExportCSV) btnExportCSV.addEventListener('click', exportMetadataCSV);

    const btnDownloadMedia = document.getElementById('btnDownloadStagedMedia');
    if (btnDownloadMedia) btnDownloadMedia.addEventListener('click', downloadStagedMediaFiles);

    const csvFileInput = document.getElementById('csvFileInput');
    if (csvFileInput) {
      csvFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
          processCSVData(event.target.result);
          closeModal('csvManagerModal');
          showToast(`Imported database from ${file.name}`, 'success');
        };
        reader.readAsText(file);
      });
    }

    const btnReloadCSV = document.getElementById('btnReloadCSV');
    if (btnReloadCSV) {
      btnReloadCSV.addEventListener('click', () => {
        loadMetadataCSV();
        closeModal('csvManagerModal');
      });
    }

    // Create Album Modal form
    const createAlbumForm = document.getElementById('createAlbumForm');
    if (createAlbumForm) {
      createAlbumForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const titleInput = document.getElementById('createAlbumTitle');
        const title = titleInput.value.trim();
        if (!title) return;

        // Switch to upload modal with this album preselected
        closeModal('createAlbumModal');
        openModal('bulkUploadModal');

        setTimeout(() => {
          const albumSelect = document.getElementById('uploadAlbumSelect');
          const newAlbumGroup = document.getElementById('newAlbumInputGroup');
          const newAlbumInput = document.getElementById('uploadNewAlbumName');
          albumSelect.value = '__NEW__';
          newAlbumGroup.style.display = 'flex';
          newAlbumInput.value = title;
        }, 150);

        titleInput.value = '';
      });
    }

    // Modal Close buttons
    document.querySelectorAll('[data-close-modal]').forEach(btn => {
      btn.addEventListener('click', () => {
        const modalId = btn.getAttribute('data-close-modal');
        closeModal(modalId);
      });
    });

    // Close modal on backdrop click
    document.querySelectorAll('.modal-backdrop').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          modal.classList.remove('open');
        }
      });
    });

    // Lightbox Controls
    const btnCloseLightbox = document.getElementById('btnCloseLightbox');
    if (btnCloseLightbox) btnCloseLightbox.addEventListener('click', closeLightbox);

    const btnNext = document.getElementById('btnLightboxNext');
    if (btnNext) btnNext.addEventListener('click', nextLightbox);

    const btnPrev = document.getElementById('btnLightboxPrev');
    if (btnPrev) btnPrev.addEventListener('click', prevLightbox);

    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      const isLightboxOpen = document.getElementById('lightboxBackdrop')?.classList.contains('open');
      if (isLightboxOpen) {
        if (e.key === 'Escape') closeLightbox();
        if (e.key === 'ArrowRight') nextLightbox();
        if (e.key === 'ArrowLeft') prevLightbox();
        return;
      }

      if (e.key === 'Escape') {
        document.querySelectorAll('.modal-backdrop.open').forEach(m => m.classList.remove('open'));
      }
    });

    // Initialize Bulk Upload & Edit Modals
    initBulkUploadModal();
    initEditModals();

    // Initialize 3D Curved Showcase Carousel and Card Tilts
    init3DCurvedCarousel();
    initCardTiltEffects();

    // Initial Load of Database CSV
    loadMetadataCSV();
  }

  // Boot on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }

})();
