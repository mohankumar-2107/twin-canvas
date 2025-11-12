document.addEventListener('DOMContentLoaded', () => {

  const socket = io('https://twin-canvas.onrender.com'); // ✅ fixed typo (https://)

  let movieStream;
  let localStream;
  let isBroadcaster = false;
  const peerConnections = {};
  const configuration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

  const urlParams = new URLSearchParams(window.location.search);
  const room = urlParams.get('room');
  const userName = localStorage.getItem('twinCanvasUserName') || 'Anonymous';

  const videoPlayer = document.getElementById('moviePlayer');
  const fileInput = document.getElementById('fileInput');
  const filePrompt = document.getElementById('filePrompt');

  const playPauseBtn = document.getElementById('playPauseBtn');
  const skipBtn = document.getElementById('skipBtn');
  const reverseBtn = document.getElementById('reverseBtn');

  const micBtn = document.getElementById('micBtn');
  const audioContainer = document.getElementById('audio-container');

  // --- YouTube-style timeline elements ---
  const videoContainer = document.getElementById('videoContainer');
  const timelineContainer = document.getElementById('timelineContainer');
  const timeline = document.getElementById('timeline');
  const currentTimeElem = document.getElementById('currentTime');
  const durationElem = document.getElementById('duration');

  let hideTimeout;

  if (!room) { window.location.href = 'index.html'; return; }

  socket.emit('join_movie_room', { room, userName });

  // --- Utility functions ---
  function nameToColor(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = hash % 360;
    return `hsl(${hue}, 70%, 60%)`;
  }

  function playAllBlockedAudio() {
    audioContainer.querySelectorAll('audio').forEach(a => a.play().catch(() => {}));
  }

  function openFullscreen() {
    const elem = document.documentElement;
    if (elem.requestFullscreen) elem.requestFullscreen();
    else if (elem.webkitRequestFullscreen) elem.webkitRequestFullscreen();
    else if (elem.msRequestFullscreen) elem.msRequestFullscreen();
  }

  // --- PeerConnection management ---
  function getOrCreatePC(socketId) {
    let pc = peerConnections[socketId];
    if (pc) return pc;

    pc = new RTCPeerConnection(configuration);
    peerConnections[socketId] = pc;

    if (localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    if (isBroadcaster && movieStream) movieStream.getTracks().forEach(t => pc.addTrack(t, movieStream));

    pc.onicecandidate = e => {
      if (e.candidate) socket.emit('ice-candidate', { room, to: socketId, candidate: e.candidate });
    };

    pc.ontrack = event => {
      const stream = event.streams[0];
      if (stream.getVideoTracks().length > 0) {
        filePrompt.style.display = 'none';
        videoPlayer.srcObject = stream;
        videoPlayer.muted = false;
        videoPlayer.play().catch(() => {});
      } else {
        let audio = document.getElementById(`audio-${socketId}`);
        if (!audio) {
          audio = document.createElement('audio');
          audio.id = `audio-${socketId}`;
          audio.controls = false;
          audioContainer.appendChild(audio);
        }
        audio.srcObject = stream;
        audio.play().catch(() => {});
      }
    };

    return pc;
  }

  async function sendOffer(to) {
    const pc = getOrCreatePC(to);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('voice-offer', { room, to, offer: pc.localDescription });
  }

  async function renegotiateAll() {
    for (const id of Object.keys(peerConnections)) {
      await sendOffer(id);
    }
  }

  // --- File upload logic (broadcaster only) ---
  fileInput.addEventListener('change', async () => {
    isBroadcaster = true;
    const file = fileInput.files[0];
    if (!file) return;

    videoPlayer.src = URL.createObjectURL(file);
    videoPlayer.muted = false;

    await videoPlayer.play().catch(() => {});
    filePrompt.style.display = 'none';
    playAllBlockedAudio();

    movieStream = videoPlayer.captureStream();
    if (!movieStream) {
      alert("Your browser does not support streaming this video.");
      return;
    }

    for (const id of Object.keys(peerConnections)) {
      const pc = getOrCreatePC(id);
      pc.getSenders()
        .filter(s => s.track && s.track.kind === 'video')
        .forEach(s => pc.removeTrack(s));
      movieStream.getTracks().forEach(t => pc.addTrack(t, movieStream));
    }
    await renegotiateAll();
  });

  // --- Playback sync ---
  playPauseBtn.addEventListener('click', () => {
    if (videoPlayer.paused) socket.emit('video_play', { room });
    else socket.emit('video_pause', { room });
  });

  skipBtn.addEventListener('click', () => {
    const newTime = Math.min(videoPlayer.currentTime + 10, videoPlayer.duration);
    socket.emit('video_seek', { room, time: newTime });
  });

  reverseBtn.addEventListener('click', () => {
    const newTime = Math.max(videoPlayer.currentTime - 10, 0);
    socket.emit('video_seek', { room, time: newTime });
  });

  socket.on('video_play', () => videoPlayer.play().catch(() => {}));
  socket.on('video_pause', () => videoPlayer.pause());
  socket.on('video_seek', (time) => videoPlayer.currentTime = time);

  // --- Timeline Logic (YouTube style) ---
  function formatTime(t) {
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  videoPlayer.addEventListener('loadedmetadata', () => {
    durationElem.textContent = formatTime(videoPlayer.duration);
    timeline.max = videoPlayer.duration;
  });

  videoPlayer.addEventListener('timeupdate', () => {
    if (!timeline.matches(':active')) timeline.value = videoPlayer.currentTime;
    currentTimeElem.textContent = formatTime(videoPlayer.currentTime);
    const percent = (videoPlayer.currentTime / videoPlayer.duration) * 100;
    timeline.style.setProperty('--progress', percent + '%');
  });

  timeline.addEventListener('input', () => {
    videoPlayer.currentTime = timeline.value;
    socket.emit('video_seek', { room, time: timeline.value });
  });

  // --- Show/hide timeline on mouse move like YouTube ---
  function showTimeline() {
    timelineContainer.style.opacity = '1';
    clearTimeout(hideTimeout);
    hideTimeout = setTimeout(() => {
      timelineContainer.style.opacity = '0';
    }, 2500);
  }

  videoContainer.addEventListener('mousemove', showTimeline);
  videoContainer.addEventListener('click', showTimeline);

  // --- Mic Logic ---
  let micOn = false;
  micBtn.addEventListener('click', async () => {
    micOn = !micOn;
    const icon = micBtn.querySelector('i');

    if (micOn && !localStream) {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true } });
        socket.emit('ready-for-voice', { room });
        for (const id of Object.keys(peerConnections)) {
          const pc = getOrCreatePC(id);
          localStream.getAudioTracks().forEach(t => pc.addTrack(t, localStream));
        }
        await renegotiateAll();
        playAllBlockedAudio();
      } catch (e) {
        console.error("Mic blocked:", e);
        micOn = false;
      }
    }

    if (localStream) localStream.getTracks().forEach(t => t.enabled = micOn);
    icon.className = micOn ? 'fas fa-microphone' : 'fas fa-microphone-slash';
  });

  // --- Update users ---
  socket.on('update_users', (userNames) => {
    const initialsContainer = document.getElementById('userInitials');
    initialsContainer.innerHTML = '';
    userNames.forEach(name => {
      const el = document.createElement('div');
      el.className = 'initial-circle';
      el.textContent = name.charAt(0).toUpperCase();
      el.style.backgroundColor = nameToColor(name);
      initialsContainer.appendChild(el);
    });
  });

  // --- WebRTC signaling events ---
  socket.on('existing-voice-users', (ids) => {
    if (!localStream) return;
    ids.forEach(id => { if (id !== socket.id) sendOffer(id); });
  });

  socket.on('user-joined-voice', ({ socketId }) => {
    if (!localStream) return;
    if (socketId !== socket.id) sendOffer(socketId);
  });

  socket.on('voice-offer', async ({ from, offer }) => {
    const pc = getOrCreatePC(from);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('voice-answer', { room, to: from, answer: pc.localDescription });
  });

  socket.on('voice-answer', async ({ from, answer }) => {
    const pc = getOrCreatePC(from);
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
  });

  socket.on('ice-candidate', async ({ from, candidate }) => {
    const pc = getOrCreatePC(from);
    try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
  });

  socket.on('user-left-voice', (socketId) => {
    peerConnections[socketId]?.close();
    delete peerConnections[socketId];
    document.getElementById(`audio-${socketId}`)?.remove();
  });
});
