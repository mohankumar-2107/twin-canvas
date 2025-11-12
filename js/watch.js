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

  // timeline elements (must exist in your HTML)
  const timeline = document.getElementById('timeline');
  const currentTimeLabel = document.getElementById('currentTime');
  const durationLabel = document.getElementById('duration');

  if (!room) { window.location.href = 'index.html'; return; }

  socket.emit('join_movie_room', { room, userName });

  // If someone already in room, they will be returned and we should offer to them
  socket.on("movie-users", (ids) => {
    // console.log("[watch] movie-users ->", ids);
    ids.forEach(id => sendOffer(id));
  });

  // small helper to create avatar color
  function nameToColor(name) {
    if (!name) return '#888';
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
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

    // add mic
    if (localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    // add movie stream if this client is broadcaster
    if (isBroadcaster && movieStream) movieStream.getTracks().forEach(t => pc.addTrack(t, movieStream));

    pc.onicecandidate = (e) => {
      if (e.candidate) socket.emit('ice-candidate', { room, to: socketId, candidate: e.candidate });
    };

    pc.ontrack = (event) => {
      const stream = event.streams[0];
      if (!stream) return;

      // if stream contains video track -> movie stream
      if (stream.getVideoTracks().length > 0) {
        filePrompt.style.display = 'none';
        videoPlayer.srcObject = stream;
        videoPlayer.muted = false;
        videoPlayer.play().catch(()=>{});
        // enable controls visually
        playPauseBtn.disabled = false;
        skipBtn.disabled = false;
        reverseBtn.disabled = false;
      } else {
        // audio-only (mic)
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

  // ---------------- File upload / stream capture ----------------
  fileInput.addEventListener('change', async () => {
    isBroadcaster = true;
    const file = fileInput.files[0];
    if (!file) return;

    videoPlayer.src = URL.createObjectURL(file);
    videoPlayer.muted = false;

    await videoPlayer.play().catch(()=>{});
    filePrompt.style.display = 'none';
    playAllBlockedAudio();

    // capture the playing element (cross-browser check)
    movieStream = (typeof videoPlayer.captureStream === 'function') 
      ? videoPlayer.captureStream()
      : (typeof videoPlayer.mozCaptureStream === 'function') ? videoPlayer.mozCaptureStream() : null;

    if (!movieStream) {
      alert("Your browser does not support captureStream(). Use Chrome/Edge for streaming.");
      return;
    }

    // if no peers yet, request list from server so they can notify peers back
    if (Object.keys(peerConnections).length === 0) {
      socket.emit("request_movie_users", { room });
      // those returned via movie-users will be offered to
    } else {
      // attach stream to existing peer connections and renegotiate
      for (const id of Object.keys(peerConnections)) {
        const pc = getOrCreatePC(id);

        // remove existing video senders
        pc.getSenders()
          .filter(s => s.track && s.track.kind === 'video')
          .forEach(s => pc.removeTrack(s));

        movieStream.getTracks().forEach(t => pc.addTrack(t, movieStream));
      }
      await renegotiateAll();
    }
  });

  // ---------------- Video playback controls (sync) ----------------

  // helper: update button icon
  function setPlayIcon(isPlaying) {
    playPauseBtn.innerHTML = isPlaying ? '<i class="fas fa-pause"></i>' : '<i class="fas fa-play"></i>';
  }

  // IMPORTANT: emit to server first, then apply locally. Server will broadcast to everyone (io.to)
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

  // remote events from server — server is authority; it broadcasts to everyone via io.to
  socket.on('video_play', () => {
    // only change if not already playing
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
    // small tolerance: if off by > 0.5s, jump
    const diff = Math.abs((videoPlayer.currentTime || 0) - time);
    if (diff > 0.5) videoPlayer.currentTime = time;
    updateTimelineUI(time);
  });

  // ---------------- Timeline logic (visible + scrub) ----------------

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
    // update CSS progress var for custom fill (if used)
    const percent = (videoPlayer.duration) ? (time / videoPlayer.duration) * 100 : 0;
    timeline.style.setProperty('--progress', `${percent}%`);
    if (currentTimeLabel) currentTimeLabel.textContent = formatTime(time);
  }

  // set duration when metadata loaded
  videoPlayer.addEventListener('loadedmetadata', () => {
    if (durationLabel) durationLabel.textContent = formatTime(videoPlayer.duration);
    if (timeline) {
      timeline.max = videoPlayer.duration;
      timeline.step = 0.1;
    }
  });

  // update time as video plays
  videoPlayer.addEventListener('timeupdate', () => {
    updateTimelineUI(videoPlayer.currentTime);
  });

  // scrubbing: when user moves the timeline, emit seek and apply locally
  if (timeline) {
    let isSeeking = false;
    timeline.addEventListener('input', (e) => {
      const t = parseFloat(e.target.value);
      updateTimelineUI(t);
    });
    timeline.addEventListener('change', (e) => {
      const t = parseFloat(e.target.value);
      videoPlayer.currentTime = t;
      socket.emit('video_seek', { room, time: t });
    });

    // pointerdown/up to avoid conflicting timeupdate while dragging
    timeline.addEventListener('pointerdown', () => { isSeeking = true; });
    timeline.addEventListener('pointerup', () => { isSeeking = false; });
  }

  // ---------------- Mic logic (unchanged) ----------------
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

  // ---------------- UI logos + voice signaling (unchanged semantics) ----------------
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
