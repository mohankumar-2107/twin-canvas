// watch.js — Timeline & controls (keeps your existing signaling + streaming logic intact)
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

  // timeline UI elements
  const timeline = document.getElementById('timeline');
  const currentTimeLabel = document.getElementById('currentTime');
  const durationLabel = document.getElementById('duration');
  const videoContainer = document.getElementById('videoContainer');
  const timelineContainer = document.getElementById('timelineContainer');

  if (!room) { window.location.href = 'index.html'; return; }

  socket.emit('join_movie_room', { room, userName });

  // --- helper functions (unchanged semantics) ---
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

    if (localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    if (isBroadcaster && movieStream) movieStream.getTracks().forEach(t => pc.addTrack(t, movieStream));

    pc.onicecandidate = e => {
      if (e.candidate) socket.emit('ice-candidate', { room, to: socketId, candidate: e.candidate });
    };

    pc.ontrack = (event) => {
      const stream = event.streams[0];
      if (!stream) return;

      // movie stream
      if (stream.getVideoTracks().length > 0) {
        filePrompt.style.display = 'none';
        videoPlayer.srcObject = stream;
        videoPlayer.muted = false;
        videoPlayer.play().catch(()=>{}); // autoplay may be blocked — button will unblock
        // enable controls
        playPauseBtn.disabled = false;
        skipBtn.disabled = false;
        reverseBtn.disabled = false;
        // ensure timeline is enabled (if duration is available it'll be set by loadedmetadata)
        if (timeline) timeline.disabled = false;
      } else {
        // mic stream
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

  // offer / renegotiate utilities (keeps your existing names)
  async function sendOffer(to) {
    const pc = getOrCreatePC(to);
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('voice-offer', { room, to, offer: pc.localDescription });
    } catch (e) {
      console.warn('sendOffer error', e);
    }
  }
  async function renegotiateAll() {
    for (const id of Object.keys(peerConnections)) {
      await sendOffer(id);
    }
  }

  // ---------------- File upload / capture (unchanged) ----------------
  fileInput.addEventListener('change', async () => {
    isBroadcaster = true;
    const file = fileInput.files[0];
    if (!file) return;

    videoPlayer.src = URL.createObjectURL(file);
    videoPlayer.muted = false;
    await videoPlayer.play().catch(()=>{});
    filePrompt.style.display = 'none';
    playAllBlockedAudio();

    movieStream = (typeof videoPlayer.captureStream === 'function')
      ? videoPlayer.captureStream()
      : (typeof videoPlayer.mozCaptureStream === 'function') ? videoPlayer.mozCaptureStream() : null;

    if (!movieStream) {
      alert('Browser does not support captureStream() - use Chrome/Edge.');
      return;
    }

    if (Object.keys(peerConnections).length === 0) {
      // ask server to return peers so we can create offers to them (you implemented this)
      socket.emit('request_movie_users', { room });
    } else {
      for (const id of Object.keys(peerConnections)) {
        const pc = getOrCreatePC(id);
        // remove prior video senders
        pc.getSenders().filter(s => s.track && s.track.kind === 'video').forEach(s => pc.removeTrack(s));
        movieStream.getTracks().forEach(t => pc.addTrack(t, movieStream));
      }
      await renegotiateAll();
    }
  });

  // ---------------- Playback sync & controls ----------------

  // helper set play icon
  function setPlayIcon(isPlaying) {
    playPauseBtn.innerHTML = isPlaying ? '<i class="fas fa-pause"></i>' : '<i class="fas fa-play"></i>';
  }

  // Play/pause: emit to server and apply locally
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

  // Skip & Reverse now update locally AND emit a SINGLE seek event (so everyone jumps)
  skipBtn.addEventListener('click', () => {
    const maxDur = videoPlayer.duration || Infinity;
    const newTime = Math.min((videoPlayer.currentTime || 0) + 10, maxDur);
    videoPlayer.currentTime = newTime;
    updateTimelineUI(newTime);
    socket.emit('video_seek', { room, time: newTime });
  });

  reverseBtn.addEventListener('click', () => {
    const newTime = Math.max((videoPlayer.currentTime || 0) - 10, 0);
    videoPlayer.currentTime = newTime;
    updateTimelineUI(newTime);
    socket.emit('video_seek', { room, time: newTime });
  });

  // remote events
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
    // tolerance so we don't fight small differences
    const localTime = videoPlayer.currentTime || 0;
    if (Math.abs(localTime - time) > 0.4) {
      videoPlayer.currentTime = time;
    }
    updateTimelineUI(time);
  });

  // ---------------- Timeline logic (robust) ----------------

  function formatTime(t) {
    if (!t || isNaN(t)) return '00:00';
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
  }

  function updateTimelineUI(time) {
    if (!timeline) return;
    timeline.value = time;
    const percent = (videoPlayer.duration) ? (time / videoPlayer.duration) * 100 : 0;
    timeline.style.setProperty('--progress', `${percent}%`);
    if (currentTimeLabel) currentTimeLabel.textContent = formatTime(time);
  }

  // set duration when metadata loaded (works even for remote stream if metadata available)
  videoPlayer.addEventListener('loadedmetadata', () => {
    if (durationLabel && !isNaN(videoPlayer.duration)) {
      durationLabel.textContent = formatTime(videoPlayer.duration);
    }
    if (timeline && !isNaN(videoPlayer.duration)) {
      timeline.max = videoPlayer.duration;
      timeline.step = 0.1;
      timeline.disabled = false;
    }
  });

  // timeupdate — update UI only when not seeking
  let isUserSeeking = false;
  videoPlayer.addEventListener('timeupdate', () => {
    if (!isUserSeeking) updateTimelineUI(videoPlayer.currentTime || 0);
  });

  // Scrub behavior:
  // - update UI on input (visual)
  // - on pointerup/change -> apply seek locally and emit single seek
  if (timeline) {
    // user starts dragging
    timeline.addEventListener('pointerdown', () => { isUserSeeking = true; });

    // update visuals while dragging
    timeline.addEventListener('input', (e) => {
      const v = parseFloat(e.target.value || 0);
      // update live label & progress
      const percent = (videoPlayer.duration) ? (v / videoPlayer.duration) * 100 : 0;
      timeline.style.setProperty('--progress', `${percent}%`);
      if (currentTimeLabel) currentTimeLabel.textContent = formatTime(v);
    });

    // user finished dragging (applies the seek and informs everyone)
    const finishSeek = (e) => {
      const v = parseFloat(e.target.value || 0);
      // apply locally
      videoPlayer.currentTime = v;
      updateTimelineUI(v);
      // emit once
      socket.emit('video_seek', { room, time: v });
      // small delay before allowing timeupdate to overwrite
      setTimeout(() => { isUserSeeking = false; }, 150);
    };

    timeline.addEventListener('change', finishSeek);
    timeline.addEventListener('pointerup', finishSeek);
    timeline.addEventListener('pointercancel', () => { isUserSeeking = false; });

    // ensure keyboard accessibility: Enter/Space changes will trigger 'change' in most browsers
  }

  // ---------------- Floating timeline appearance (double-tap & mousemove) ----------------

   // ---------------- Floating timeline: show only in fullscreen ----------------

  const videoContainer = document.getElementById('videoContainer');
  const timelineContainer = document.getElementById('timelineContainer');
  let floatingTimer = null;

  // helper: detect if fullscreen
  function isFullscreen() {
    return document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement;
  }

  function showFloatingTimeline() {
    if (!timelineContainer || !isFullscreen()) return; // only in fullscreen
    timelineContainer.classList.add('visible');
    clearTimeout(floatingTimer);
    floatingTimer = setTimeout(() => {
      timelineContainer.classList.remove('visible');
    }, 4000); // hide after 4s
  }

  // hide instantly when exiting fullscreen
  document.addEventListener('fullscreenchange', () => {
    if (!isFullscreen()) {
      timelineContainer?.classList.remove('visible');
    }
  });

  // show timeline triggers
  videoPlayer.addEventListener('pause', showFloatingTimeline);
  videoPlayer.addEventListener('seeked', showFloatingTimeline);
  videoContainer?.addEventListener('mousemove', showFloatingTimeline);
  videoContainer?.addEventListener('touchstart', showFloatingTimeline);
  videoContainer?.addEventListener('dblclick', showFloatingTimeline);

  // hide shortly after play resumes
  videoPlayer.addEventListener('play', () => {
    clearTimeout(floatingTimer);
    if (isFullscreen()) {
      floatingTimer = setTimeout(() => {
        timelineContainer.classList.remove('visible');
      }, 2000);
    }
  });

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

  // ---------------- Signaling / UI logos (unchanged) ----------------
  socket.on('movie-users', (ids) => ids.forEach(id => sendOffer(id)));

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
