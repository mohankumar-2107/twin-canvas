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
  const customUploadBtn = document.getElementById('customUploadBtn'); // ✅ custom button
  const playPauseBtn = document.getElementById('playPauseBtn');
  const skipBtn = document.getElementById('skipBtn');
  const reverseBtn = document.getElementById('reverseBtn');
  const micBtn = document.getElementById('micBtn');
  const audioContainer = document.getElementById('audio-container');

  // timeline UI elements
  const videoContainer = document.getElementById('videoContainer');
  const timelineContainer = document.getElementById('timelineContainer');
  const timeline = document.getElementById('timeline');
  const currentTimeElem = document.getElementById('currentTime');
  const durationElem = document.getElementById('duration');

  let isMuted = true;
  let timelineVisible = false;
  let timelineTimeout;

  if (!room) {
    window.location.href = 'index.html';
    return;
  }

  // ✅ Join movie room
  socket.emit('join_movie_room', { room, userName });

  // ✅ Fix: clicking the custom button opens file dialog every browser
  customUploadBtn.addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.setAttribute('capture', 'filesystem'); // helps mobile browsers

  // ✅ Local file open logic (SYNC mode, not streaming)
  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (file) {
      videoPlayer.src = URL.createObjectURL(file);
      filePrompt.style.display = 'none';
      unmuteBlockedAudio();
    }
  });

  // ✅ Sync controls
  playPauseBtn.addEventListener('click', () => {
    if (videoPlayer.paused) {
      socket.emit('video_play', { room });
    } else {
      socket.emit('video_pause', { room });
    }
  });

  skipBtn.addEventListener('click', () => {
    const newTime = videoPlayer.currentTime + 10;
    socket.emit('video_seek', { room, time: newTime });
  });

  reverseBtn.addEventListener('click', () => {
    const newTime = videoPlayer.currentTime - 10;
    socket.emit('video_seek', { room, time: newTime });
  });

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

  // ✅ Timeline
  function formatTime(seconds) {
      if (isNaN(seconds)) return "0:00";
      const m = Math.floor(seconds / 60);
      const s = Math.floor(seconds % 60);
      return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  videoPlayer.addEventListener('loadedmetadata', () => {
      timeline.max = videoPlayer.duration;
      durationElem.textContent = formatTime(videoPlayer.duration);
  });

  videoPlayer.addEventListener('timeupdate', () => {
      if (!timeline.matches(':active')) {
        timeline.value = videoPlayer.currentTime;
      }
      currentTimeElem.textContent = formatTime(videoPlayer.currentTime);
  });

  timeline.addEventListener('input', () => {
      socket.emit('video_seek', { room, time: timeline.value });
  });

  function toggleTimeline() {
      timelineVisible = !timelineVisible;
      timelineContainer.style.opacity = timelineVisible ? '1' : '0';
      if (timelineVisible) {
          clearTimeout(timelineTimeout);
          timelineTimeout = setTimeout(() => {
              timelineContainer.style.opacity = '0';
              timelineVisible = false;
          }, 3000);
      }
  }

  videoContainer.addEventListener('dblclick', toggleTimeline);
  videoContainer.addEventListener('click', unmuteBlockedAudio);

  // ✅ Audio Unblock Helper
  function unmuteBlockedAudio() {
    audioContainer.querySelectorAll('audio').forEach(a => {
      a.play().catch(()=>{});
    });
  }

  // ✅ Show user logos
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
      const circle = document.createElement('div');
      circle.className = 'initial-circle';
      circle.textContent = name[0].toUpperCase();
      circle.title = name;
      circle.style.backgroundColor = nameToColor(name);
      initialsContainer.appendChild(circle);
    });
  });

  // ✅ Mic WebRTC
  function getOrCreatePC(socketId) {
    let pc = peerConnections[socketId];
    if (pc) return pc;
    pc = new RTCPeerConnection(configuration);
    peerConnections[socketId] = pc;

    if (localStream) {
      localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    }

    pc.onicecandidate = e => {
      if (e.candidate)
        socket.emit('ice-candidate', { room, to: socketId, candidate: e.candidate });
    };

    pc.ontrack = e => {
      const stream = e.streams[0];
      if (stream.getVideoTracks().length === 0) {
        let audio = document.getElementById(`audio-${socketId}`);
        if (!audio) {
          audio = document.createElement('audio');
          audio.id = `audio-${socketId}`;
          audio.autoplay = true;
          audioContainer.appendChild(audio);
        }
        audio.srcObject = stream;
        audio.play().catch(()=>{});
      }
    };

    return pc;
  }

  async function sendOffer(id) {
    const pc = getOrCreatePC(id);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('voice-offer', { room, to: id, offer: pc.localDescription });
  }

  micBtn.addEventListener('click', async () => {
    isMuted = !isMuted;
    const icon = micBtn.querySelector('i');

    if (!localStream && !isMuted) {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true }
        });
        socket.emit('ready-for-voice', { room });
        unmuteBlockedAudio();
      } catch (e) {
        console.error("Mic blocked:", e);
        isMuted = true;
      }
    }

    if (localStream) {
      localStream.getTracks().forEach(t => t.enabled = !isMuted);
    }

    icon.className = isMuted ? 'fas fa-microphone-slash' : 'fas fa-microphone';
  });

  socket.on('existing-voice-users', (ids) => {
    if (!localStream) return;
    ids.forEach(id => {
      if (id !== socket.id) sendOffer(id);
    });
  });

  socket.on('user-joined-voice', ({ socketId }) => {
    if (!localStream) return;
    if (socketId !== socket.id) sendOffer(socketId);
  });

  socket.on('voice-offer', async ({ from, offer }) => {
    if (!localStream) return;
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
    if (pc) {
      try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
    }
  });

  socket.on('user-left-voice', (socketId) => {
    peerConnections[socketId]?.close();
    delete peerConnections[socketId];
    document.getElementById(`audio-${socketId}`)?.remove();
  });

});
