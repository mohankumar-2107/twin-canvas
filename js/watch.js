// watch.js — full updated file
document.addEventListener('DOMContentLoaded', () => {

  const socket = io('https://twin-canvas.onrender.com');

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

  // --- timeline elements ---
  const videoContainer = document.getElementById('videoContainer');
  const timeline = document.getElementById('timeline');
  const currentTimeLabel = document.getElementById('currentTime');
  const durationLabel = document.getElementById('duration');
  const timelineContainer = document.getElementById('timelineContainer');

  let hideTimelineTimeout;

  if (!room) { window.location.href = 'index.html'; return; }

  socket.emit('join_movie_room', { room, userName });

  socket.on("movie-users", (ids) => {
    ids.forEach(id => sendOffer(id));
  });

  function nameToColor(name) {
    if (!name) return '#888';
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 70%, 60%)`;
  }

  function playAllBlockedAudio() {
    audioContainer.querySelectorAll('audio').forEach(a => a.play().catch(()=>{}));
  }

  function getOrCreatePC(socketId) {
    let pc = peerConnections[socketId];
    if (pc) return pc;

    pc = new RTCPeerConnection(configuration);
    peerConnections[socketId] = pc;

    if (localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    if (isBroadcaster && movieStream) movieStream.getTracks().forEach(t => pc.addTrack(t, movieStream));

    pc.onicecandidate = (e) => {
      if (e.candidate) socket.emit('ice-candidate', { room, to: socketId, candidate: e.candidate });
    };

    pc.ontrack = (event) => {
      const stream = event.streams[0];
      if (!stream) return;

      if (stream.getVideoTracks().length > 0) {
        filePrompt.style.display = 'none';
        videoPlayer.srcObject = stream;
        videoPlayer.muted = false;
        videoPlayer.play().catch(()=>{});
        playPauseBtn.disabled = false;
        skipBtn.disabled = false;
        reverseBtn.disabled = false;
      } else {
        let audio = document.getElementById(`audio-${socketId}`);
        if (!audio) {
          audio = document.createElement('audio');
          audio.id = `audio-${socketId}`;
          audio.autoplay = true;
          audio.controls = false;
          audioContainer.appendChild(audio);
        }
        audio.srcObject = stream;
        audio.play().catch(()=>{});
      }
    };

    return pc;
  }

  async function sendOffer(to) {
    const pc = getOrCreatePC(to);
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('voice-offer', { room, to, offer: pc.localDescription });
    } catch (e) {
      console.warn("sendOffer error", e);
    }
  }

  async function renegotiateAll() {
    for (const id of Object.keys(peerConnections)) {
      await sendOffer(id);
    }
  }

  // --- File Upload Logic ---
  fileInput.addEventListener('change', async () => {
    isBroadcaster = true;
    const file = fileInput.files[0];
    if (!file) return;

    videoPlayer.src = URL.createObjectURL(file);
    videoPlayer.muted = false;
    await videoPlayer.play().catch(()=>{});
    filePrompt.style.display = 'none';
    playAllBlockedAudio();

    movieStream = (videoPlayer.captureStream && videoPlayer.captureStream()) || 
                  (videoPlayer.mozCaptureStream && videoPlayer.mozCaptureStream());
    if (!movieStream) {
      alert("Your browser does not support captureStream().");
      return;
    }

    if (Object.keys(peerConnections).length === 0) {
      socket.emit("request_movie_users", { room });
    } else {
      for (const id of Object.keys(peerConnections)) {
        const pc = getOrCreatePC(id);
        pc.getSenders().filter(s => s.track && s.track.kind === 'video').forEach(s => pc.removeTrack(s));
        movieStream.getTracks().forEach(t => pc.addTrack(t, movieStream));
      }
      await renegotiateAll();
    }
  });

  // --- Sync Controls ---
  function setPlayIcon(isPlaying) {
    playPauseBtn.innerHTML = isPlaying ? '<i class="fas fa-pause"></i>' : '<i class="fas fa-play"></i>';
  }

  playPauseBtn.addEventListener('click', () => {
    if (videoPlayer.paused) {
      socket.emit('video_play', { room });
      videoPlayer.play().catch(()=>{});
      setPlayIcon(true);
    } else {
      socket.emit('video_pause', { room });
      videoPlayer.pause();
      setPlayIcon(false);
    }
  });

  skipBtn.addEventListener('click', () => {
    const newTime = Math.min(videoPlayer.currentTime + 10, videoPlayer.duration || Infinity);
    videoPlayer.currentTime = newTime;
    socket.emit('video_seek', { room, time: newTime });
    updateTimelineUI(newTime);
  });

  reverseBtn.addEventListener('click', () => {
    const newTime = Math.max(videoPlayer.currentTime - 10, 0);
    videoPlayer.currentTime = newTime;
    socket.emit('video_seek', { room, time: newTime });
    updateTimelineUI(newTime);
  });

  socket.on('video_play', () => {
    if (videoPlayer.paused) {
      videoPlayer.play().catch(()=>{});
      setPlayIcon(true);
    }
  });
  socket.on('video_pause', () => {
    if (!videoPlayer.paused) {
      videoPlayer.pause();
      setPlayIcon(false);
    }
  });
  socket.on('video_seek', (time) => {
    if (Math.abs(videoPlayer.currentTime - time) > 0.5) videoPlayer.currentTime = time;
    updateTimelineUI(time);
  });

  // --- Timeline Logic (YouTube Style) ---
 // ---------------- Timeline logic (fixed alignment + viewer lock) ----------------

// helper to format mm:ss
function formatTime(t) {
  if (!t || isNaN(t)) return "00:00";
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
}

// update both the range and labels
function updateTimelineUI(time) {
  if (!timeline) return;
  timeline.value = time;
  const percent = (videoPlayer.duration) ? (time / videoPlayer.duration) * 100 : 0;
  timeline.style.setProperty('--progress', `${percent}%`);
  if (currentTimeLabel) currentTimeLabel.textContent = formatTime(time);
}

videoPlayer.addEventListener('loadedmetadata', () => {
  const dur = videoPlayer.duration;
  if (isFinite(dur)) {
    durationLabel.textContent = formatTime(dur);
    timeline.max = dur;
    timeline.step = 0.1;
  } else {
    durationLabel.textContent = "00:00";
  }

  // ✅ viewer lock: disable seeking if not broadcaster
  if (!isBroadcaster) timeline.disabled = true;
});

videoPlayer.addEventListener('timeupdate', () => {
  updateTimelineUI(videoPlayer.currentTime);
});

// ✅ Allow seeking only for broadcaster
if (timeline) {
  timeline.addEventListener('input', (e) => {
    if (!isBroadcaster) return; // prevent viewer scrubbing
    const t = parseFloat(e.target.value);
    updateTimelineUI(t);
  });
  timeline.addEventListener('change', (e) => {
    if (!isBroadcaster) return;
    const t = parseFloat(e.target.value);
    videoPlayer.currentTime = t;
    socket.emit('video_seek', { room, time: t });
  });
}

// ✅ Show/hide timeline like YouTube
function showTimeline() {
  if (!timelineContainer) return;
  timelineContainer.style.opacity = '1';
  clearTimeout(hideTimelineTimeout);
  hideTimelineTimeout = setTimeout(() => {
    timelineContainer.style.opacity = '0';
  }, 2500);
}
videoContainer.addEventListener('mousemove', showTimeline);
videoContainer.addEventListener('click', showTimeline);

  // --- Mic Logic (unchanged) ---
  let micOn = false;
  micBtn.addEventListener('click', async () => {
    micOn = !micOn;
    const icon = micBtn.querySelector('i');

    if (micOn && !localStream) {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true }});
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

  // --- Update User Icons (unchanged) ---
  socket.on('update_users', (userNames) => {
    const initialsContainer = document.getElementById('userInitials');
    initialsContainer.innerHTML = '';
    userNames.forEach(name => {
      const el = document.createElement('div');
      el.className = 'initial-circle';
      el.textContent = (name ? name.charAt(0).toUpperCase() : '?');
      el.style.backgroundColor = nameToColor(name || 'Anon');
      initialsContainer.appendChild(el);
    });
  });

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
    try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch (e) {}
  });

  socket.on('user-left-voice', (socketId) => {
    peerConnections[socketId]?.close();
    delete peerConnections[socketId];
    document.getElementById(`audio-${socketId}`)?.remove();
  });

});
