document.addEventListener('DOMContentLoaded', () => {
    const socket = io('https://twin-canvas.onrender.com'); // Your Render URL
    
    let movieStream;
    let isBroadcaster = false;

    function nameToColor(name) {
        let hash = 0;
        for (let i = 0; i < name.length; i++) {
            hash = name.charCodeAt(i) + ((hash << 5) - hash);
        }
        const hue = hash % 360;
        return `hsl(${hue}, 70%, 60%)`;
    }

    const urlParams = new URLSearchParams(window.location.search);
    const room = urlParams.get('room');
    const userName = localStorage.getItem('twinCanvasUserName') || 'Anonymous';

    const videoPlayer = document.getElementById('moviePlayer');
    const fileInput = document.getElementById('fileInput');
    const filePrompt = document.getElementById('filePrompt');
    const playPauseBtn = document.getElementById('playPauseBtn');
    const skipBtn = document.getElementById('skipBtn');
    const reverseBtn = document.getElementById('reverseBtn');
    
    let isSyncing = false; 

    if (!room) { window.location.href = 'index.html'; return; }
    
    socket.emit('join_movie_room', { room, userName });

    // --- Broadcaster File Select Logic ---
    fileInput.addEventListener('change', () => {
        isBroadcaster = true;
        const file = fileInput.files[0];
        if (file) {
            videoPlayer.src = URL.createObjectURL(file);
            videoPlayer.muted = true; 
            videoPlayer.play();
            filePrompt.style.display = 'none';

            movieStream = videoPlayer.captureStream();

            // --- Renegotiation Logic (sends new offer) ---
            for (const peerId in peerConnections) {
                const pc = peerConnections[peerId];
                movieStream.getTracks().forEach(track => {
                    pc.addTrack(track, movieStream);
                });
                pc.createOffer()
                    .then(offer => pc.setLocalDescription(offer))
                    .then(() => {
                        socket.emit('voice-offer', { 
                            room, 
                            offer: pc.localDescription, 
                            to: peerId 
                        });
                    });
            }
        }
    });

    // --- Video Control Sync Logic ---
    playPauseBtn.addEventListener('click', () => {
        if (videoPlayer.paused) { videoPlayer.play(); } else { videoPlayer.pause(); }
    });
    skipBtn.addEventListener('click', () => {
        videoPlayer.currentTime += 10;
        socket.emit('video_seek', { room, time: videoPlayer.currentTime });
    });
    reverseBtn.addEventListener('click', () => {
        videoPlayer.currentTime -= 10;
        socket.emit('video_seek', { room, time: videoPlayer.currentTime });
    });

    videoPlayer.addEventListener('play', () => {
        if (isSyncing) { isSyncing = false; return; }
        if (isBroadcaster) { socket.emit('video_play', { room }); }
        playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
    });
    videoPlayer.addEventListener('pause', () => {
        if (isSyncing) { isSyncing = false; return; }
        if (isBroadcaster) { socket.emit('video_pause', { room }); }
        playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
    });

    socket.on('video_play', () => { isSyncing = true; videoPlayer.play(); playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>'; });
    socket.on('video_pause', () => { isSyncing = true; videoPlayer.pause(); playPauseBtn.innerHTML = '<i class="fas fa-play"></i>'; });
    socket.on('video_seek', (time) => { isSyncing = true; videoPlayer.currentTime = time; });

    // --- Voice Chat & Logo Logic ---
    const micBtn = document.getElementById('micBtn');
    const audioContainer = document.getElementById('audio-container');
    let localStream;
    let peerConnections = {};
    let isMuted = true;
    const configuration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

    micBtn.addEventListener('click', async () => {
        isMuted = !isMuted;
        const micIcon = micBtn.querySelector('i');
        if (!localStream) {
            try {
                localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                socket.emit('ready-for-voice', { room });
            } catch (error) { console.error("Mic access error.", error); isMuted = true; return; }
        }
        localStream.getTracks().forEach(track => track.enabled = !isMuted);
        micIcon.className = isMuted ? 'fas fa-microphone-slash' : 'fas fa-microphone';
    });

    socket.on('update_users', (userNames) => {
        const initialsContainer = document.getElementById('userInitials');
        initialsContainer.innerHTML = ''; 
        userNames.forEach(name => {
            const initial = name.charAt(0).toUpperCase();
            const color = nameToColor(name);
            const circle = document.createElement('div');
            circle.className = 'initial-circle';
            circle.textContent = initial;
            circle.title = name;
            circle.style.backgroundColor = color;
            initialsContainer.appendChild(circle);
        });
    });
    
    const createPeerConnection = (socketId) => {
        const pc = new RTCPeerConnection(configuration);
        peerConnections[socketId] = pc;
        
        if (localStream) {
            localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
        }
        
        if (isBroadcaster && movieStream) {
            movieStream.getTracks().forEach(track => pc.addTrack(track, movieStream));
        }
        
        pc.onicecandidate = e => { if (e.candidate) socket.emit('ice-candidate', { room, to: socketId, candidate: e.candidate }); };
        
        pc.ontrack = (event) => {
            if (event.track.kind === 'video') {
                filePrompt.style.display = 'none';
                videoPlayer.srcObject = event.streams[0];
                videoPlayer.play();
                playPauseBtn.disabled = true;
                skipBtn.disabled = true;
                reverseBtn.disabled = true;
            } else if (event.track.kind === 'audio') {
                if (event.streams[0].getVideoTracks().length === 0) {
                    let audio = document.getElementById(`audio-${socketId}`);
                    if (!audio) {
                        audio = document.createElement('audio');
                        audio.id = `audio-${socketId}`;
                        audio.autoplay = true;
                        audioContainer.appendChild(audio);
                    }
                    audio.srcObject = event.streams[0];
                }
            }
        };
        return pc;
    };
    
    socket.on('existing-voice-users', (userIds) => {
        if (!localStream) return;
        userIds.forEach(id => {
            const pc = createPeerConnection(id);
            pc.createOffer().then(offer => pc.setLocalDescription(offer))
              .then(() => socket.emit('voice-offer', { room, to: id, offer: pc.localDescription }));
        });
    });

    socket.on('user-joined-voice', (socketId) => {
        if (!localStream) return;
        const pc = createPeerConnection(socketId);
        pc.createOffer().then(offer => pc.setLocalDescription(offer))
          .then(() => socket.emit('voice-offer', { room, to: socketId, offer: pc.localDescription }));
    });

    // --- THIS IS THE CRITICAL FIX ---
    socket.on('voice-offer', ({ from, offer }) => {
        if (!localStream) return; // Wait for mic
        
        // Find the EXISTING connection, or create one if it doesn't exist
        let pc = peerConnections[from];
        if (!pc) {
            pc = createPeerConnection(from);
        }
        
        // Now set the remote description on the correct connection
        pc.setRemoteDescription(new RTCSessionDescription(offer))
          .then(() => pc.createAnswer())
          .then(answer => pc.setLocalDescription(answer))
          .then(() => socket.emit('voice-answer', { room, to: from, answer: pc.localDescription }));
    });
    // --- END OF FIX ---

    socket.on('voice-answer', ({ from, answer }) => {
        peerConnections[from]?.setRemoteDescription(new RTCSessionDescription(answer));
    });

    socket.on('ice-candidate', ({ from, candidate }) => {
        peerConnections[from]?.addIceCandidate(new RTCIceCandidate(candidate));
    });

    socket.on('user-left-voice', (socketId) => {
        peerConnections[socketId]?.close();
        delete peerConnections[socketId];
        document.getElementById(`audio-${socketId}`)?.remove();
    });
});
