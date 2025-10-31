document.addEventListener('DOMContentLoaded', () => {
    const socket = io('https://twin-canvas.onrender.com'); // Your Render URL

    function nameToColor(name) { /* ... (same as before) ... */ }

    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    let isDrawing = false;
    let lastX = 0;
    let lastY = 0;
    let currentTool = 'pen';
    let history = [];
    let direction = true; // For brush effect

    const colorPicker = document.getElementById('colorPicker');
    const strokeWidthSlider = document.getElementById('strokeWidth');
    const toolButtons = document.querySelectorAll('.tool');
    const clearBtn = document.getElementById('clearBtn');
    const saveBtn = document.getElementById('saveBtn');
    const undoBtn = document.getElementById('undoBtn');

    const urlParams = new URLSearchParams(window.location.search);
    const room = urlParams.get('room');
    const userName = localStorage.getItem('twinCanvasUserName') || 'Anonymous';

    if (!room) { window.location.href = 'index.html'; return; }

    socket.emit('join_room', { room, userName });

    // --- ADDED VOICE CHAT & WEBRTC LOGIC ---
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
    // --- END OF VOICE CHAT LOGIC ---

    function draw(x, y, lastX, lastY, color, width, tool) {
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.globalCompositeOperation = (tool === 'eraser') ? 'destination-out' : 'source-over';
        
        // --- ADDED PAINTBRUSH EFFECT ---
        if (tool === 'brush') {
            ctx.globalAlpha = 0.3; // Semi-transparent for a watercolor effect
            // Vary line width for a more natural stroke
            if (ctx.lineWidth > 40 || ctx.lineWidth < 10) { direction = !direction; }
            ctx.lineWidth += (direction ? 0.5 : -0.5);
        } else {
            ctx.globalAlpha = 1.0; // Reset for other tools
        }
        // --- END OF PAINTBRUSH EFFECT ---
        
        ctx.moveTo(lastX, lastY);
        ctx.lineTo(x, y);
        ctx.stroke();
    }

    function handleStart(e) { /* ... (same as before) ... */ }

    function handleMove(e) {
        if (!isDrawing) return;
        const { x, y } = getCoordinates(e);
        const drawData = {
            room, x, y, lastX, lastY,
            color: colorPicker.value,
            width: strokeWidthSlider.value,
            tool: currentTool
        };
        draw(x, y, lastX, lastY, drawData.color, drawData.width, drawData.tool);
        socket.emit('draw', drawData);
        [lastX, lastY] = [x, y];
    }

    function handleEnd() { /* ... (same as before) ... */ }
    function getCoordinates(e) { /* ... (same as before) ... */ }
    
    canvas.addEventListener('mousedown', handleStart);
    // ... (all other event listeners are the same) ...

    toolButtons.forEach(button => {
        button.addEventListener('click', () => {
            document.querySelector('.tool.active')?.classList.remove('active');
            button.classList.add('active');
            currentTool = button.dataset.tool;
        });
    });

    // ... (rest of the file is mostly the same, with WebRTC listeners added below) ...

    // --- SOCKET.IO LISTENERS ---
    socket.on('update_users', (userNames) => { /* ... (same as before) ... */ });
    socket.on('draw', (data) => {
        draw(data.x, data.y, data.lastX, data.lastY, data.color, data.width, data.tool);
    });
    socket.on('clear', () => { ctx.clearRect(0, 0, canvas.width, canvas.height); });
    
    // --- ADDED WEBRTC SOCKET LISTENERS ---
    const createPeerConnection = (socketId) => {
        const pc = new RTCPeerConnection(configuration);
        peerConnections[socketId] = pc;
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
        pc.onicecandidate = e => { if (e.candidate) socket.emit('ice-candidate', { room, to: socketId, candidate: e.candidate }); };
        pc.ontrack = e => {
            let audio = document.getElementById(`audio-${socketId}`);
            if (!audio) {
                audio = document.createElement('audio');
                audio.id = `audio-${socketId}`;
                audio.autoplay = true;
                audioContainer.appendChild(audio);
            }
            audio.srcObject = e.streams[0];
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

    socket.on('voice-offer', ({ from, offer }) => {
        if (!localStream) return;
        const pc = createPeerConnection(from);
        pc.setRemoteDescription(offer)
          .then(() => pc.createAnswer())
          .then(answer => pc.setLocalDescription(answer))
          .then(() => socket.emit('voice-answer', { room, to: from, answer: pc.localDescription }));
    });

    socket.on('voice-answer', ({ from, answer }) => {
        peerConnections[from]?.setRemoteDescription(answer);
    });

    socket.on('ice-candidate', ({ from, candidate }) => {
        peerConnections[from]?.addIceCandidate(new RTCIceCandidate(candidate));
    });

    socket.on('user-left-voice', (socketId) => {
        peerConnections[socketId]?.close();
        delete peerConnections[socketId];
        document.getElementById(`audio-${socketId}`)?.remove();
    });
    // --- END OF WEBRTC LISTENERS ---
});
