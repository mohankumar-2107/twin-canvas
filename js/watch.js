document.addEventListener('DOMContentLoaded', () => {

  const socket = io('https://twin-canvas.onrender.com');

  const urlParams = new URLSearchParams(window.location.search);
  const room = urlParams.get('room');
  const userName = localStorage.getItem('twinCanvasUserName') || 'Anonymous';

  if (!room) {
    window.location.href = 'index.html';
    return;
  }

  // JOIN ROOM
  socket.emit('join_movie_room', { room, userName });

  const videoPlayer = document.getElementById('moviePlayer');
  const filePrompt = document.getElementById('filePrompt');
  const customUploadBtn = document.getElementById('customUploadBtn');
  const fileInput = document.getElementById('fileInput');

  const playPauseBtn = document.getElementById('playPauseBtn');
  const skipBtn = document.getElementById('skipBtn');
  const reverseBtn = document.getElementById('reverseBtn');
  const micBtn = document.getElementById('micBtn');

  const timeline = document.getElementById('timeline');
  const currentTimeElem = document.getElementById('currentTime');
  const durationElem = document.getElementById('duration');
  const timelineContainer = document.getElementById('timelineContainer');
  const videoContainer = document.getElementById('videoContainer');

  let timelineVisible = false;
  let timelineTimeout;

  // ✅ OPEN FILE PICKER
  customUploadBtn.addEventListener('click', () => fileInput.click());

  // ✅ WHEN USER SELECTS MOVIE FILE
  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;

    videoPlayer.src = URL.createObjectURL(file);
    filePrompt.style.display = 'none';
  });

  // ✅ CONTROL BUTTONS
  playPauseBtn.addEventListener('click', () => {
    if (videoPlayer.paused) {
      socket.emit('video_play', { room });
    } else {
      socket.emit('video_pause', { room });
    }
  });

  reverseBtn.addEventListener('click', () => {
    socket.emit('video_seek', { room, time: videoPlayer.currentTime - 10 });
  });

  skipBtn.addEventListener('click', () => {
    socket.emit('video_seek', { room, time: videoPlayer.currentTime + 10 });
  });

  // ✅ UPDATE UI WHEN SERVER TELLS
  socket.on('video_play', () => {
    videoPlayer.play().catch(()=>{});
    playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
  });

  socket.on('video_pause', () => {
    videoPlayer.pause();
    playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
  });

  socket.on('video_seek', (time) => {
    videoPlayer.currentTime = time;
  });

  // ✅ TIMELINE DISPLAY
  function formatTime(sec) {
    if (isNaN(sec)) return "0:00";
    const m = Math.floor(sec/60);
    const s = Math.floor(sec%60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  videoPlayer.addEventListener('loadedmetadata', () => {
    timeline.max = videoPlayer.duration;
    durationElem.textContent = formatTime(videoPlayer.duration);
  });

  videoPlayer.addEventListener('timeupdate', () => {
    timeline.value = videoPlayer.currentTime;
    currentTimeElem.textContent = formatTime(videoPlayer.currentTime);
  });

  timeline.addEventListener('input', () => {
    socket.emit('video_seek', { room, time: timeline.value });
  });

  // Show timeline when double click
  videoContainer.addEventListener('dblclick', () => {
    timelineVisible = true;
    timelineContainer.style.opacity = '1';
    clearTimeout(timelineTimeout);
    timelineTimeout = setTimeout(() => {
      timelineVisible = false;
      timelineContainer.style.opacity = '0';
    }, 3000);
  });

  // ✅ MIC LOGIC (same as draw page)
  const audioContainer = document.getElementById('audio-container');
  let localStream;
  let isMuted = true;

  micBtn.addEventListener('click', async () => {
    isMuted = !isMuted;

    const icon = micBtn.querySelector('i');

    if (!localStream && !isMuted) {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true }
        });
        socket.emit('ready-for-voice', { room });
      } catch (e) {
        isMuted = true;
        return;
      }
    }

    if (localStream) {
      localStream.getTracks().forEach(t => t.enabled = !isMuted);
    }

    icon.className = isMuted ? 'fas fa-microphone-slash' : 'fas fa-microphone';
  });

  // ✅ LOGO SYSTEM
  function nameToColor(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return `hsl(${hash % 360}, 70%, 60%)`;
  }

  socket.on('update_users', (userNames) => {
    const initialsContainer = document.getElementById('userInitials');
    initialsContainer.innerHTML = '';
    userNames.forEach(name => {
      const div = document.createElement('div');
      div.className = 'initial-circle';
      div.style.backgroundColor = nameToColor(name);
      div.textContent = name[0].toUpperCase();
      initialsContainer.appendChild(div);
    });
  });
});
