function updateAlbumArt(track) {
  try {
    const img = document.getElementById('albumArt');
    
    if (!img) {
      console.error('updateAlbumArt: #albumArt element not found');
      return;
    }

    // Check if track exists and has embeddedArtUrl
    if (track && track.embeddedArtUrl) {
      img.src = track.embeddedArtUrl;
      console.log('Set art to embedded:', track.embeddedArtUrl);
    } else {
      img.src = '/assets/default-art.svg?v=' + Date.now();
      console.log('Set art to default SVG');
    }
  } catch (err) {
    console.error('updateAlbumArt error:', err);
  }
}

// If you need to call it on page load:
document.addEventListener('DOMContentLoaded', function() {
  // Only call if you have an initial track object
  // updateAlbumArt(window.currentTrack);
});