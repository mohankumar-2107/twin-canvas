document.addEventListener('DOMContentLoaded', () => {
    const socket = io('https://twin-canvas.onrender.com');

    let localStream; // Mic
    let screenStream; // Screen
    const peerConnections = {};
    const configuration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

    const urlParams = new URLSearchParams(window.location.search);
    const room = urlParams.get('room');
    const userName = localStorage.getItem('twinCanvasUserName') || 'Anonymous';

    const screenVideo = document.getElementById('screenVideo');
    const startShareBtn = document.getElementById('startShareBtn');
    const stopShareBtn = document.getElementById('stopShareBtn');
    const startSharePrompt = document.getElementById('startSharePrompt');
    const micBtn = document.getElementById('micBtn');
    const audioContainer = document.getElementById('audio-container');
    let isMuted = true;

    if (!room) { window.location.href = 'index.html'; return; }

    // Use a new, separate join event
    socket.emit('join_screen_room', { room, userName });

    // --- Helper function from your other files ---
    function nameToColor(name) {
        let hash = 0;
        for (let i = 0; i < name.length; i++) {
            hash = name.charCodeAt(i) + ((hash << 5) - hash);
        }
        const hue = hash % 360;
        return `hsl(${hue}, 70%, 60%)`;
    }

    function playAllBlockedAudio() {
        audioContainer.querySelectorAll('audio').forEach(audio => {
            audio.play().catch(e => console.warn("Audio play blocked", e));
        });
    }

    // --- WebRTC Logic (Same as your other rooms) ---
    function getOrCreatePC(socketId) {
        let pc = peerConnections[socketId];
        if (pc) return pc;
        pc = new RTCPeerConnection(configuration);
        peerConnections[socketId] = pc;

        if (localStream) { // Add mic
            localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
        }
        if (screenStream) { // Add screen
            screenStream.getTracks().forEach(t => pc.addTrack(t, screenStream));
        }

        pc.onicecandidate = e => {
            if (e.candidate) socket.emit('ice-candidate', { room, to: socketId, candidate: e.candidate });
        };

        pc.ontrack = (event) => {
            const stream = event.streams[0];
            if (event.track.kind === 'video') {
                // This is the screen share stream
                startSharePrompt.style.display = 'none';
                screenVideo.srcObject = stream;
            } else if (event.track.kind === 'audio') {
                // This is the mic stream
                let audio = document.getElementById(`audio-${socketId}`);
                if (!audio) {
                    audio = document.createElement('audio');
                    audio.id = `audio-${socketId}`;
                    audio.autoplay = true;
                    audioContainer.appendChild(audio);
                }
                audio.srcObject = stream;
                audio.play().catch(e => console.warn("Mic audio blocked"));
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

    // --- Start Sharing Button ---
    startShareBtn.addEventListener('click', async () => {
        try {
            // 1. Get the screen stream
            screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: { cursor: "always" },
                audio: { echoCancellation: true, noiseSuppression: true } // Capture desktop audio
            });
            
            startSharePrompt.style.display = 'none';
            stopShareBtn.style.display = 'inline-block';
            screenVideo.srcObject = screenStream;
            screenVideo.muted = true; // Mute local preview to prevent echo

            // 2. Add stream to all connections and renegotiate
            for (const id of Object.keys(peerConnections)) {
                const pc = getOrCreatePC(id);
                screenStream.getTracks().forEach(t => pc.addTrack(t, screenStream));
            }
            await renegotiateAll();

            // 3. Handle when user clicks the browser's "Stop sharing" button
            screenStream.getVideoTracks()[0].onended = () => {
                stopSharing();
            };

        } catch (err) {
            console.error("Error starting screen share:", err);
        }
    });

    // --- Stop Sharing Button ---
    function stopSharing() {
        if (!screenStream) return;
        
        // 1. Stop all tracks
        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;

        // 2. Remove the tracks from the connection and renegotiate
        for (const id of Object.keys(peerConnections)) {
            const pc = getOrCreatePC(id);
            pc.getSenders()
              .filter(s => s.track && (s.track.kind === 'video' || s.track.label.includes('System Audio')))
              .forEach(s => pc.removeTrack(s));
        }
        renegotiateAll(); // Tell everyone the stream is gone

        // 3. Reset UI
        startSharePrompt.style.display = 'flex';
        stopShareBtn.style.display = 'none';
        screenVideo.srcObject = null;
    }
    stopShareBtn.addEventListener('click', stopSharing);

    // --- MIC LOGIC (Identical to drawing room) ---
    micBtn.addEventListener('click', async () => {
        isMuted = !isMuted;
        const icon = micBtn.querySelector('i');
        if (!isMuted && !localStream) {
            try {
                localStream = await navigator.mediaDevices.getUserMedia({ 
                    audio: { echoCancellation: true, noiseSuppression: true } 
                });
                socket.emit('ready-for-voice', { room });
                playAllBlockedAudio();
                await renegotiateAll(); // Add mic to connections
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
    
    // --- Signaling Events (Identical to other rooms) ---
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
        await peerConnections[from]?.setRemoteDescription(new RTCSessionDescription(answer));
    });
    socket.on('ice-candidate', async ({ from, candidate }) => {
        await peerConnections[from]?.addIceCandidate(new RTCIceCandidate(candidate));
    });
    socket.on('user-left-voice', (socketId) => {
        peerConnections[socketId]?.close();
        delete peerConnections[socketId];
        document.getElementById(`audio-${socketId}`)?.remove();
    });
});
