// ===== Global State =====
let songs = [], filteredSongs = [], currentIdx = -1;
let isShuffle = false;
let repeatMode = 0; // 0=off, 1=all, 2=one
let playHistory = [];
let db;
let dbReady = openDB();  // open once at top level
let lyrics = [];
let currentLyricIndex = -1;
let waveformData = [];
let nextIdx = -1;


// ===== Audio + Web Audio Setup =====
const audio = document.getElementById('audio');
const audioNext = document.getElementById('audio-next');
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

// ===== EQ / Filters Setup - MUST BE BEFORE CONNECTING =====
const freqs = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000];
const filters = freqs.map(f => {
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'peaking';
  filter.frequency.value = f;
  filter.Q.value = 1;
  filter.gain.value = 0;
  return filter;
});

// Chain filters together
for (let i = 0; i < filters.length - 1; i++) {
  filters[i].connect(filters[i + 1]);
}

const analyser = audioCtx.createAnalyser();
analyser.fftSize = 256;
filters[filters.length - 1].connect(analyser);
analyser.connect(audioCtx.destination);

// ===== Crossfade Setup =====
const sourceA = audioCtx.createMediaElementSource(audio);
const sourceB = audioCtx.createMediaElementSource(audioNext);

const gainA = audioCtx.createGain();
const gainB = audioCtx.createGain();

// Route: source -> gain -> EQ chain
sourceA.connect(gainA).connect(filters[0]);
sourceB.connect(gainB).connect(filters[0]);

gainA.gain.value = 1;
gainB.gain.value = 0;

let activeAudio = audio;
let activeGain = gainA;
let nextAudio = audioNext;
let nextGain = gainB;
let crossfadeMs = 5000; // 5 seconds - smooth, DJ-style  

// ===== UI Elements =====
const fileInput = document.getElementById('file-input');
const folderInput = document.getElementById('folder-input');
const addSongsBtn = document.getElementById('add-songs-btn');
const addFolderBtn = document.getElementById('add-folder-btn');
const deleteStuckBtn = document.getElementById('delete-stuck');
const songList = document.getElementById('song-list');
const playBtn = document.getElementById('play');
const prevBtn = document.getElementById('prev');
const nextBtn = document.getElementById('next');
const shuffleBtn = document.getElementById('shuffle');
const repeatBtn = document.getElementById('repeat');
const saveEqBtn = document.getElementById('save-eq');
const eqPresetSelect = document.getElementById('eq-preset');
const searchInput = document.getElementById('search');
const timer = document.getElementById('timer');
const volume = document.getElementById('volume');
const vuCanvas = document.getElementById('vu-meter');
const vuCtx = vuCanvas?.getContext('2d');
const eqPreview = document.getElementById('eq-preview');
const eqCtx = eqPreview?.getContext('2d');
const albumArt = document.getElementById('album-art');
const nowTitle = document.getElementById('now-title');
const nowArtist = document.getElementById('now-artist');
const lyricsBox = document.getElementById('lyrics-box');
const waveformCanvas = document.getElementById('waveform');

// ===== Crossfade Functions =====
function loadSong(idx) {
  currentIdx = idx;
  const song = songs[idx];
  if (!song) return;

  activeAudio.pause();
  nextAudio.pause();
  activeGain.gain.cancelScheduledValues(audioCtx.currentTime);
  nextGain.gain.cancelScheduledValues(audioCtx.currentTime);
  activeGain.gain.value = 1;
  nextGain.gain.value = 0;

  if (activeAudio.src) URL.revokeObjectURL(activeAudio.src);
  const url = URL.createObjectURL(song.blob);
  activeAudio.src = url;
  activeAudio.play();

  // Update cover art using the helper
  updateAlbumArt(song);
  updateUI(song);
  
  
}
function updateAlbumArt(song) {
  try {
    const img = document.getElementById('albumArt');

    if (!img) {
      console.error('updateAlbumArt: #albumArt element not found');
      return;
    }

    if (song && song.art) {
      // Song has embedded art
      img.src = song.art;
      document.getElementById('cover').classList.remove('no-song');
    } else {
      // No embedded art, use default SVG
      img.src = 'assets/default-art.svg?v=' + Date.now();
      document.getElementById('cover').classList.add('no-song');
    }
  } catch (err) {
    console.error('updateAlbumArt error:', err);
  }
}

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    renderWaveform(); 
  }, 100);
});
function preloadNextSong() {
  if (currentIdx < 0 || songs.length < 2) return;

  if (isShuffle) {
    do {
      nextIdx = Math.floor(Math.random() * songs.length);
    } while (nextIdx === currentIdx);
  } else if (repeatMode === 1) {
    nextIdx = (currentIdx + 1) % songs.length;
  } else {
    nextIdx = currentIdx + 1;
    if (nextIdx >= songs.length) {
      nextIdx = -1;
      return;
    } // end of queue
  }

  if (nextIdx < 0 ||!songs[nextIdx]) return;
  if (nextAudio.src) URL.revokeObjectURL(nextAudio.src);
  const url = URL.createObjectURL(songs[nextIdx].blob);
  nextAudio.src = url;
  nextAudio.load();
}

let isCrossfading = false;
function crossfade() {
  if (isCrossfading) return;

  // If repeat one, don't crossfade - just loop current
  if (repeatMode === 2) {
    activeAudio.currentTime = 0;
    activeAudio.play();
    return;
  }

  // If nextAudio isn’t loaded, nothing to crossfade to
  if (nextAudio.readyState < 2) {
    isCrossfading = false;
    return;
  }

  isCrossfading = true;
  const now = audioCtx.currentTime;

  activeGain.gain.setValueAtTime(activeGain.gain.value, now);
  activeGain.gain.linearRampToValueAtTime(0, now + crossfadeMs / 1000);

  nextGain.gain.setValueAtTime(0, now);
  nextGain.gain.linearRampToValueAtTime(1, now + crossfadeMs / 1000);

  nextAudio.play();

  setTimeout(() => {
  activeAudio.pause();
  [activeAudio, nextAudio] = [nextAudio, activeAudio];
  [activeGain, nextGain] = [nextGain, activeGain];

  currentIdx = nextIdx; // now this matches what was actually preloaded
  // Now currentIdx is correct, so UI will update to the right song
  updateAlbumArt(songs[currentIdx]);
  updateUI(songs[currentIdx]);
  preloadNextSong();
  isCrossfading = false;
}, crossfadeMs);
}
function updateUI(song) {
  if (nowTitle) nowTitle.textContent = song.title;
  if (nowArtist) nowArtist.textContent = song.artist;
  
  loadLyrics(song.blob);
  drawWaveform(song.blob);
  renderPlaylist();

  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: song.title,
      artist: song.artist,
      album: song.album,
      artwork: song.art? [{ src: song.art, sizes: '512x512', type: 'image/jpeg' }] : []
    });
  }
}

// ===== IndexedDB =====
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('musicDB', 1);
    req.onupgradeneeded = e => {
      db = e.target.result;
      if (!db.objectStoreNames.contains('songs')) {
        db.createObjectStore('songs', { keyPath: 'id' });
      }
    };
    req.onsuccess = e => { db = e.target.result; resolve(db); };
    req.onerror = e => reject(e.target.error);
  });
}

function dbPut(song) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('songs', 'readwrite');
    tx.objectStore('songs').put(song);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function dbGetAll() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('songs', 'readonly');
    const req = tx.objectStore('songs').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbDelete(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('songs', 'readwrite');
    tx.objectStore('songs').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ===== ID3 Tag Reader =====
async function readTags(file) {
  return new Promise(resolve => {
    window.jsmediatags.read(file, {
      onSuccess: tag => {
        const t = tag.tags;
        let artData = null;
        if (t.picture) {
          artData = { data: t.picture.data, format: t.picture.format };
        }
        resolve({
          title: t.title || file.name.replace(/\.[^/.]+$/, ""),
          artist: t.artist || 'Unknown Artist',
          album: t.album || 'Unknown Album',
          artData
        });
      },
      onError: () => resolve({
        title: file.name.replace(/\.[^/.]+$/, ""),
        artist: 'Unknown Artist',
        album: 'Unknown Album',
        artData: null
      })
    });
  });
}

// ===== File Handling =====
if (addSongsBtn && fileInput) addSongsBtn.onclick = () => fileInput.click();
if (addFolderBtn && folderInput) addFolderBtn.onclick = () => folderInput.click();

function handleFiles(fileList) {
  dbReady.then(async () => {
    let count = 0;
    for (const file of fileList) {
      if (!file.type.startsWith('audio/') &&!/\.(mp3|m4a|flac|ogg|wav)$/i.test(file.name)) continue;
      if (file.name.startsWith('.')) continue;
      try {
        const id = crypto.randomUUID();
        const meta = await readTags(file);
        await dbPut({ id, name: file.name, blob: file, path: file.webkitRelativePath || file.name,...meta });
        count++;
      } catch (err) {
        console.error('Failed to save:', file.name, err);
      }
    }
    
    await loadSongs();
    // Auto-play first song if nothing is playing yet
    if (songs.length > 0 && currentIdx === -1) {
    loadSong(0);
  // Need user gesture to actually play due to browser autoplay rules
  playBtn.textContent = '▶️'; // show play icon
  nowTitle.textContent = songs[0].title;
  nowArtist.textContent = songs[0].artist;
  updateAlbumArt(songs[0]);
}
    if (fileInput) fileInput.value = '';
    if (folderInput) folderInput.value = '';
  });
}

if (fileInput) fileInput.onchange = e => handleFiles(e.target.files);
if (folderInput) folderInput.onchange = e => handleFiles(e.target.files);

if (deleteStuckBtn) {
  deleteStuckBtn.onclick = async () => {
    if (!confirm('Delete all songs?')) return;
    const tx = db.transaction('songs', 'readwrite');
    tx.objectStore('songs').clear();
    tx.oncomplete = () => loadSongs();
  };
}

// ===== Playlist Rendering + Search =====
if (searchInput) {
  searchInput.oninput = () => {
    const query = searchInput.value.toLowerCase();
    if (!query) {
      filteredSongs = [...songs];
    } else {
      filteredSongs = songs.filter(s =>
        s.title.toLowerCase().includes(query) ||
        s.artist.toLowerCase().includes(query) ||
        s.album.toLowerCase().includes(query)
      );
    }
    renderPlaylist();
  };
}

function renderPlaylist() {
  const list = searchInput && searchInput.value? filteredSongs : songs;
  songList.innerHTML = list.map(s => {
    const realIdx = songs.indexOf(s);
    let folder = '';
    if (s.path && s.path.includes('/')) {
      folder = ' • ' + s.path.split('/').slice(0, -1).join('/');
    }
    return `
    <li data-idx="${realIdx}" class="${realIdx === currentIdx? 'active' : ''}">
      <img class="song-thumb" src="${s.art || 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2240%22 height=%2240%22%3E%3Crect fill=%22%23333%22 width=%2240%22 height=%2240%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 fill=%22%23666%22 text-anchor=%22middle%22 dy=%22.3em%22 font-size=%2220%22%3E♪%3C/text%3E%3C/svg%3E'}" alt="">
      <div class="song-meta">
        <div class="song-title">${s.title}</div>
        <div class="song-artist">${s.artist}${folder}</div>
      </div>
      <button class="del-song" data-id="${s.id}">✕</button>
    </li>`;
  }).join('');
}

async function loadSongs() {
  const rawSongs = await dbGetAll();
  songs = rawSongs.map(s => {
    if (s.artData) {
      const byteArray = new Uint8Array(s.artData.data);
      const blob = new Blob([byteArray], { type: s.artData.format });
      s.art = URL.createObjectURL(blob);
    } else {
      s.art = null;
    }
    return s;
  });
  filteredSongs = [...songs];
  renderPlaylist();

  // Auto-load first song on app start if none selected
  if (songs.length > 0 && currentIdx === -1) {
    loadSong(0);
    playBtn.textContent = '▶️';
    nowTitle.textContent = songs[0].title;
    nowArtist.textContent = songs[0].artist;
    updateAlbumArt(songs[0]);
  }
}

songList.onclick = e => {
  const li = e.target.closest('li');
  if (e.target.classList.contains('del-song')) {
    const id = e.target.dataset.id;
    dbDelete(id).then(loadSongs);
    return;
  }
  if (li) loadSong(parseInt(li.dataset.idx));
};

// ===== Lyrics + Waveform =====
function loadLyrics(file) {
  lyrics = [];
  lyricsBox.innerHTML = '';
  currentLyricIndex = -1;
}

function parseLRC(text) {
  lyrics = [];
  const lines = text.split('\n');
  const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/;
  lines.forEach(line => {
    const match = line.match(timeRegex);
    if (match) {
      const min = parseInt(match[1]);
      const sec = parseInt(match[2]);
      const ms = parseInt(match[3].padEnd(3, '0'));
      const time = min * 60 + sec + ms / 1000;
      const text = line.replace(timeRegex, '').trim();
      if (text) lyrics.push({ time, text });
    }
  });
  lyrics.sort((a, b) => a.time - b.time);
  renderLyrics();
}

function renderLyrics() {
  if (!lyricsBox) return;
  lyricsBox.innerHTML = lyrics.map((l, i) =>
    `<div class="lyric-line" data-index="${i}">${l.text}</div>`
  ).join('');
}

async function drawWaveform(file) {
  if (!waveformCanvas) return;
  const arrayBuffer = await file.arrayBuffer();
  const tempCtx = new (window.AudioContext || window.webkitAudioContext)();
  const audioBuffer = await tempCtx.decodeAudioData(arrayBuffer);
  const rawData = audioBuffer.getChannelData(0);
  const samples = 300;
  const blockSize = Math.floor(rawData.length / samples);
  waveformData = [];
  for (let i = 0; i < samples; i++) {
    let sum = 0;
    for (let j = 0; j < blockSize; j++) {
      sum += Math.abs(rawData[i * blockSize + j] || 0);
    }
    waveformData.push(sum / blockSize);
  }
  renderWaveform();
  tempCtx.close();
}

function renderWaveform() {
  if (!waveformCanvas || !waveformData.length) return;
  const ctx = waveformCanvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  
  // Get CSS size, set canvas buffer to match DPI
  const rect = waveformCanvas.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;
  
  // Only resize if dimensions changed - prevents flicker
  if (waveformCanvas.width !== width * dpr || waveformCanvas.height !== height * dpr) {
    waveformCanvas.width = width * dpr;
    waveformCanvas.height = height * dpr;
    ctx.scale(dpr, dpr); // Scale so 1 unit = 1 CSS pixel
  }
  
  const barWidth = width / waveformData.length;
  const progress = activeAudio.currentTime / activeAudio.duration || 0;
  
  ctx.clearRect(0, 0, width, height);
  
  waveformData.forEach((val, i) => {
    const barHeight = val * height * 2; // *2 makes it more visible
    const x = i * barWidth;
    const y = (height - barHeight) / 2;
    
    // Brighter colors + better contrast
    ctx.fillStyle = i / waveformData.length < progress 
      ? '#1ed760'  // Bright Spotify green for played
      : '#535353'; // Lighter gray for unplayed, was #404040
    
    ctx.fillRect(x, y, Math.max(1, barWidth - 1), barHeight);
  });
}


// ===== Controls =====
let isPlayPending = false;

function setupControls() {
  if (playBtn) {
    playBtn.onclick = async () => {
      if (isPlayPending) return;
      
      if (audioCtx.state === 'suspended') await audioCtx.resume();

      if (currentIdx === -1 && songs.length > 0) loadSong(0);

      if (activeAudio.paused) {
        isPlayPending = true;
        activeAudio.play().then(() => {
          playBtn.textContent = '⏸';
          isPlayPending = false;
        }).catch(err => {
          if (err.name !== 'AbortError') console.error('Play failed:', err);
          isPlayPending = false;
        });
      } else {
        activeAudio.pause();
        playBtn.textContent = '▶️';
      }
    };
  }

  if (prevBtn) {
    prevBtn.onclick = () => {
      if (isShuffle && playHistory.length) {
        loadSong(playHistory.pop());
      } else if (currentIdx > 0) {
        playHistory.push(currentIdx);
        loadSong(currentIdx - 1);
      }
    };
  }

  if (nextBtn) {
  nextBtn.onclick = () => {
    if (isShuffle && songs.length > 1) {
      let next;
      do { next = Math.floor(Math.random() * songs.length); }
      while (next === currentIdx);
      playHistory.push(currentIdx);
      loadSong(next);
    } else if (currentIdx < songs.length - 1) {
      if (isShuffle) playHistory.push(currentIdx);
      loadSong(currentIdx + 1);
    } else if (repeatMode === 1) {
      loadSong(0);
    }
  };
}

  if (shuffleBtn) {
    shuffleBtn.onclick = () => {
      isShuffle = !isShuffle;
      shuffleBtn.classList.toggle('active', isShuffle);
      console.log('Shuffle:', isShuffle); // for debugging

      // Re-preload next song using new shuffle state
    preloadNextSong();
    };
  }

  if (repeatBtn) {
    repeatBtn.onclick = () => {
      repeatMode = (repeatMode + 1) % 3;
      repeatBtn.classList.toggle('active', repeatMode > 0);
      repeatBtn.textContent = repeatMode === 2 ? '🔂' : '🔁';
      console.log('Repeat mode:', repeatMode); // for debugging
    };
  }
}

// Call it after DOM elements exist
setupControls();

// ===== Seek + Volume =====
function updateTimeUI() {
  if (!activeAudio.duration) return;
  const fmt = t => `${Math.floor(t / 60)}:${Math.floor(t % 60).toString().padStart(2, '0')}`;
  if (timer) timer.textContent = `${fmt(activeAudio.currentTime)} / ${fmt(activeAudio.duration)}`;
  renderWaveform();

  if (!lyrics.length) return;
  const time = activeAudio.currentTime;
  let newIndex = -1;
  for (let i = lyrics.length - 1; i >= 0; i--) {
    if (time >= lyrics[i].time) {
      newIndex = i;
      break;
    }
  }
  if (newIndex!== currentLyricIndex) {
    document.querySelectorAll('.lyric-line').forEach(el => el.classList.remove('active'));
    if (newIndex >= 0) {
      const activeEl = lyricsBox?.querySelector(`[data-index="${newIndex}"]`);
      if (activeEl) {
        activeEl.classList.add('active');
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
    currentLyricIndex = newIndex;
  }
}

audio.addEventListener('timeupdate', updateTimeUI);
audioNext.addEventListener('timeupdate', updateTimeUI);

if (waveformCanvas) {
  waveformCanvas.onclick = (e) => {
    const rect = waveformCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = x / rect.width;
    if (activeAudio.duration) activeAudio.currentTime = percent * activeAudio.duration;
  };
}

if (volume) {
  volume.oninput = () => {
    audio.volume = volume.value;
    audioNext.volume = volume.value;
  };
}

// ===== EQ Sliders + Presets =====
function createEQSliders() {
  const container = document.getElementById('eq-controls');
  if (!container) {
    console.error('Missing #eq-controls div in HTML');
    return;
  }
  container.innerHTML = freqs.map((f, i) => `
    <div class="eq-band">
      <input type="range" min="-12" max="12" value="0" data-idx="${i}">
      <div>0</div>
      <label>${f >= 1000? f / 1000 + 'k' : f}</label>
    </div>
  `).join('');

  container.querySelectorAll('input').forEach(slider => {
    slider.oninput = e => {
      const idx = parseInt(e.target.dataset.idx);
      const val = parseInt(e.target.value);
      if (filters[idx]) filters[idx].gain.value = val;
      e.target.nextElementSibling.textContent = val > 0? `+${val}` : val;
      detectPreset();
    };
  });
}

function loadEQ() {
  const saved = localStorage.getItem('eqPreset');
  if (saved) {
    const gains = JSON.parse(saved);
    gains.forEach((g, i) => {
      if (filters[i]) {
        filters[i].gain.value = g;
        const slider = document.querySelectorAll('.eq-band input')[i];
        const label = document.querySelectorAll('.eq-band div')[i];
        if (slider) slider.value = g;
        if (label) label.textContent = g > 0? `+${g}` : g;
      }
    });
  }
  const savedName = localStorage.getItem('eqPresetName');
  if (savedName && eqPresetSelect) eqPresetSelect.value = savedName;
}

const EQ_PRESETS = {
  flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  bass: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
  rock: [4, 3, 2, 0, -1, -1, 1, 3, 4, 4],
  pop: [2, 1, 0, 2, 3, 2, 1, 0, 0, 0],
  vocal: [0, -1, -2, -1, 1, 4, 4, 3, 1, 0],
  electronic: [4, 3, 1, 0, -1, 1, 0, 2, 4, 5],
  custom: []
};

function applyEQPreset(name) {
  const gains = EQ_PRESETS[name];
  if (!gains) return;
  gains.forEach((g, i) => {
    if (filters[i]) {
      filters[i].gain.value = g;
      const slider = document.querySelectorAll('.eq-band input')[i];
      const label = document.querySelectorAll('.eq-band div')[i];
      if (slider) slider.value = g;
      if (label) label.textContent = g > 0? `+${g}` : g;
    }
  });
  localStorage.setItem('eqPresetName', name);
  if (name!== 'custom') localStorage.setItem('eqPreset', JSON.stringify(gains));
}

function detectPreset() {
  const current = filters.map(f => Math.round(f.gain.value));
  for (const [name, gains] of Object.entries(EQ_PRESETS)) {
    if (name === 'custom') continue;
    if (gains.every((g, i) => g === current[i])) {
      if (eqPresetSelect) eqPresetSelect.value = name;
      return;
    }
  }
  if (eqPresetSelect) eqPresetSelect.value = 'custom';
  EQ_PRESETS.custom = current;
}

if (eqPresetSelect) eqPresetSelect.onchange = () => applyEQPreset(eqPresetSelect.value);

if (saveEqBtn) {
  saveEqBtn.onclick = () => {
    const gains = filters.map(f => Math.round(f.gain.value));
    EQ_PRESETS.custom = gains;
    localStorage.setItem('eqPreset', JSON.stringify(gains));
    localStorage.setItem('eqPresetName', 'custom');
    if (eqPresetSelect) eqPresetSelect.value = 'custom';
    saveEqBtn.textContent = '✓';
    setTimeout(() => saveEqBtn.textContent = '💾', 1000);
  };
}

// ===== Visualizers =====
const dataArray = new Uint8Array(analyser.frequencyBinCount);

function drawVU() {
  if (!vuCtx ||!vuCanvas) return;
  requestAnimationFrame(drawVU);
  analyser.getByteFrequencyData(dataArray);
  const avg = dataArray.reduce((a, b) => a + b) / dataArray.length;
  const w = vuCanvas.width = vuCanvas.offsetWidth;
  const h = vuCanvas.height = vuCanvas.offsetHeight;
  vuCtx.clearRect(0, 0, w, h);
  const grad = vuCtx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, '#00ff00');
  grad.addColorStop(0.5, '#ffff00');
  grad.addColorStop(1, '#ff0000');
  vuCtx.fillStyle = grad;
  vuCtx.fillRect(0, 0, (avg / 255) * w, h);
}

function drawEQPreview() {
  if (!eqCtx ||!eqPreview) return;
  requestAnimationFrame(drawEQPreview);
  analyser.getByteFrequencyData(dataArray);
  const w = eqPreview.width;
  const h = eqPreview.height;
  eqCtx.clearRect(0, 0, w, h);
  const barWidth = w / dataArray.length * 2.5;
  for (let i = 0; i < dataArray.length; i++) {
    const barHeight = (dataArray[i] / 255) * h;
    eqCtx.fillStyle = `hsl(${i / dataArray.length * 360}, 100%, 50%)`;
    eqCtx.fillRect(i * barWidth, h - barHeight, barWidth - 1, barHeight);
  }
}

// ===== Crossfade Event Listeners =====
[audio, audioNext].forEach(aud => {
  aud.addEventListener('timeupdate', () => {
    if (aud === activeAudio && aud.duration && aud.currentTime > aud.duration - crossfadeMs / 1000 - 0.1) {
      if (nextAudio.readyState >= 2 && nextAudio.paused) crossfade();
    }
  });

  // Replace the old 'ended' listeners with this:
  aud.addEventListener('ended', () => {
    if (isCrossfading) return;

    // Repeat one
    if (repeatMode === 2) {
      aud.currentTime = 0;
      aud.play();
      return;
    }

    // Shuffle
    if (isShuffle && songs.length > 1) {
      let next;
      do {
        next = Math.floor(Math.random() * songs.length);
      } while (next === currentIdx);
      playHistory.push(currentIdx);
      loadSong(next);
      return;
    }

    // Normal next / repeat all
    if (currentIdx < songs.length - 1) {
      if (!isShuffle) playHistory.push(currentIdx);
      loadSong(currentIdx + 1);
    } else if (repeatMode === 1) {
      loadSong(0); // repeat all: loop to first
    } else {
      playBtn.textContent = '▶️'; // end of queue
    }
  });
});
// ===== Media Session =====
if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('play', () => playBtn?.click());
  navigator.mediaSession.setActionHandler('pause', () => playBtn?.click());
  navigator.mediaSession.setActionHandler('previoustrack', () => prevBtn?.click());
  navigator.mediaSession.setActionHandler('nexttrack', () => nextBtn?.click());
}

// ===== Auto-adjust playlist margins =====
function setPlaylistMargins() {
  const top = document.querySelector('.top-fixed')?.offsetHeight || 0;
  const bottom = document.querySelector('.bottom-fixed')?.offsetHeight || 0;
  const playlist = document.querySelector('.playlist');
  if (playlist) {
    playlist.style.marginTop = top + 'px';
    playlist.style.marginBottom = bottom + 'px';
  }
}

// ===== Init =====
createEQSliders();
loadEQ();
drawVU();
drawEQPreview();
dbReady.then(loadSongs);
setPlaylistMargins();
window.addEventListener('resize', setPlaylistMargins);

// ===== Cleanup =====
window.addEventListener('beforeunload', () => {
  songs.forEach(s => {
    if (s.art && s.art.startsWith('blob:')) URL.revokeObjectURL(s.art);
  });
  if (audio.src && audio.src.startsWith('blob:')) URL.revokeObjectURL(audio.src);
  if (audioNext.src && audioNext.src.startsWith('blob:')) URL.revokeObjectURL(audioNext.src);
});

// ===== Service Worker =====
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
     .then(reg => console.log('SW registered:', reg.scope))
     .catch(err => console.log('SW registration failed:', err));
  });
}