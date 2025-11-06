document.addEventListener('DOMContentLoaded', () => {

  const socket = io('https://twin-canvas.onrender.com');

  let localStream;
  const peerConnections = {};
  const configuration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

  const urlParams = new URLSearchParams(window.location.search);
  const room = urlParams.get('room');
  const userName = localStorage.getItem('twinCanvasUserName') || 'Anonymous';

  const videoPlayer = document.getElementById('moviePlayer');
  const fileInput = document.getElementById('fileInput');
  const filePrompt = document.getElementById('filePrompt');
  const customUploadBtn = document.getElementById('customUploadBtn');  // ✅ ADD
  const playPauseBtn = document.getElementById('playPauseBtn');
  const skipBtn = document.getElementById('skipBtn');
  const reverseBtn = document.getElementById('reverseBtn');
  const micBtn = document.getElementById('micBtn');
  const audioContainer = document.getElementById('audio-container');

  if (!room) { window.location.href = 'index.html'; return; }

  socket.emit('join_movie_room', { room, userName });


  // ✅ CLICK FIX — NOW FILE PICKER OPENS
  customUploadBtn.addEventListener("click", () => {
    fileInput.click();
  });

  // ✅ also prevent mobile browsers from blocking file dialog
  fileInput.setAttribute("capture", "filesystem");


  function nameToColor(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return `hsl(${hash % 360}, 70%, 60%)`;
  }


  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (file) {
      videoPlayer.src = URL.createObjectURL(file);
      filePrompt.style.display = 'none';
    }
  });


  // ✅ SHOW USER INITIALS (LOGO) – WORKING
  socket.on('update_users', (userNames) => {
    const initialsContainer = document.getElementById('userInitials');
    initialsContainer.innerHTML = '';
    userNames.forEach(name => {
      const circle = document.createElement('div');
      circle.className = 'initial-circle';
      circle.textContent = name[0].toUpperCase();
      circle.style.backgroundColor = nameToColor(name);
      circle.title = name;
      initialsContainer.appendChild(circle);
    });
  });

  // KEEP REST OF YOUR MIC + SEEK + PLAYPAUSE CODE SAME
});
