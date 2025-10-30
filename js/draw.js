document.addEventListener('DOMContentLoaded', () => {
    const socket = io('https://your-render-url-goes-here.onrender.com');
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');

    // --- SETUP ---
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // --- STATE ---
    let isDrawing = false;
    let lastX = 0;
    let lastY = 0;
    let currentTool = 'pen';
    let history = [];
    let historyIndex = -1; // Index for undo/redo

    // --- TOOLBAR ELEMENTS ---
    const colorPicker = document.getElementById('colorPicker');
    const strokeWidthSlider = document.getElementById('strokeWidth');
    const toolButtons = document.querySelectorAll('.main-toolbar .tool'); // Select from main toolbar
    const undoBtn = document.getElementById('undoBtn');
    const clearBtn = document.getElementById('clearBtn');
    const saveBtn = document.getElementById('saveBtn');

    // --- URL PARAMS ---
    const urlParams = new URLSearchParams(window.location.search);
    const room = urlParams.get('room');
    const userName = localStorage.getItem('twinCanvasUserName') || 'Anonymous';
    
    if (!room) {
        window.location.href = 'index.html'; // Redirect if no room is specified
        return;
    }

    socket.emit('join_room', { room, userName });

    // --- CANVAS VISUAL SPLIT ---
    function drawSplitLine() {
        ctx.save(); // Save current state
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(0,0,0,0.1)'; // Faint grey line
        ctx.lineWidth = 1;
        ctx.moveTo(canvas.width / 2, 0);
        ctx.lineTo(canvas.width / 2, canvas.height);
        ctx.stroke();
        ctx.restore(); // Restore previous state
    }
    drawSplitLine(); // Draw on initial load

    // --- DRAWING FUNCTIONS ---
    function draw(x, y, lastX, lastY, color, width, tool) {
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        
        if (tool === 'eraser') {
            ctx.globalCompositeOperation = 'destination-out';
        } else {
            ctx.globalCompositeOperation = 'source-over';
        }
        
        ctx.moveTo(lastX, lastY);
        ctx.lineTo(x, y);
        ctx.stroke();
    }

    function handleStart(e) {
        isDrawing = true;
        const { x, y } = getCoordinates(e);
        [lastX, lastY] = [x, y];
        // Ensure history is clean for new drawings
        if (historyIndex < history.length - 1) {
            history = history.slice(0, historyIndex + 1);
        }
        saveState(); // Save state before drawing
    }
    
    function handleMove(e) {
        if (!isDrawing) return;
        e.preventDefault(); // Prevent scrolling on touch devices

        const { x, y } = getCoordinates(e);

        const drawData = {
            room,
            x, y, lastX, lastY,
            color: colorPicker.value,
            width: strokeWidthSlider.value,
            tool: currentTool
        };

        // Draw locally and emit to others
        draw(x, y, lastX, lastY, drawData.color, drawData.width, drawData.tool);
        socket.emit('draw', drawData);

        [lastX, lastY] = [x, y];
    }

    function handleEnd() {
        if (!isDrawing) return;
        isDrawing = false;
        ctx.beginPath();
    }
    
    function getCoordinates(e) {
        if (e.touches && e.touches.length > 0) {
            return { x: e.touches[0].clientX, y: e.touches[0].clientY };
        }
        return { x: e.clientX, y: e.clientY };
    }

    // --- EVENT LISTENERS ---
    // Mouse events
    canvas.addEventListener('mousedown', handleStart);
    canvas.addEventListener('mousemove', handleMove);
    canvas.addEventListener('mouseup', handleEnd);
    canvas.addEventListener('mouseleave', handleEnd);

    // Touch events
    canvas.addEventListener('touchstart', handleStart);
    canvas.addEventListener('touchmove', handleMove);
    canvas.addEventListener('touchend', handleEnd);
    
    // Tool selection
    toolButtons.forEach(button => {
        button.addEventListener('click', () => {
            const activeTool = document.querySelector('.main-toolbar .tool.active');
            if (activeTool) {
                activeTool.classList.remove('active');
            }
            button.classList.add('active');
            currentTool = button.dataset.tool;
        });
    });

    // Clear canvas
    clearBtn.addEventListener('click', () => {
        saveState(); // Save current state before clearing for undo
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawSplitLine(); // Redraw split line
        socket.emit('clear', { room });
    });

    // Save canvas
    saveBtn.addEventListener('click', () => {
        const dataURL = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.href = dataURL;
        link.download = `TwinCanvas_${room}_${new Date().getTime()}.png`;
        link.click();
    });

    // Undo functionality
    function saveState() {
        history.push(canvas.toDataURL());
        historyIndex = history.length - 1;
    }

    function undoLast() {
        if (historyIndex > 0) {
            historyIndex--;
            const lastState = history[historyIndex];
            const img = new Image();
            img.src = lastState;
            img.onload = () => {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0);
                drawSplitLine(); // Redraw split line after undo
            };
            socket.emit('undo', { room, state: lastState });
        } else if (historyIndex === 0) { // If only one state left, clear canvas
            historyIndex = -1;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            drawSplitLine();
            socket.emit('clear', { room }); // Or emit a specific 'undo_to_empty'
        }
    }
    undoBtn.addEventListener('click', undoLast);
    
    // Resize canvas
    window.addEventListener('resize', () => {
        // Store current image, resize, then redraw
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        ctx.putImageData(imgData, 0, 0);
        
        // Re-apply settings
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        drawSplitLine(); // Redraw split line
        // Also redraw current state from history if available
        if (historyIndex >= 0) {
            const img = new Image();
            img.src = history[historyIndex];
            img.onload = () => {
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height); // Adjust size to new canvas size
                drawSplitLine();
            };
        }
    });
    
    // --- SOCKET.IO LISTENERS ---
    socket.on('draw', (data) => {
        draw(data.x, data.y, data.lastX, data.lastY, data.color, data.width, data.tool);
    });

    socket.on('clear', () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawSplitLine();
    });

    socket.on('undo', (data) => {
        // When undo is received from other user, update local canvas
        const img = new Image();
        img.src = data.state;
        img.onload = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0);
            drawSplitLine();
        };
        // Note: syncing history array across clients for full undo/redo is complex.
        // This just syncs the visual state after an undo.
    });

    socket.on('user_joined', (data) => {
        console.log(`${data.userName} joined the room!`);
        // You could add a small toast notification here
        // For existing users, send current canvas state to new user
        if (historyIndex >= 0) {
            socket.emit('canvas_state', { room, state: history[historyIndex], targetId: socket.id });
        }
    });
    
    socket.on('canvas_state', (data) => {
        // Only load if this client is the target and has no history yet
        if (socket.id === data.targetId && historyIndex === -1) {
            const img = new Image();
            img.src = data.state;
            img.onload = () => {
                ctx.drawImage(img, 0, 0);
                drawSplitLine();
                history.push(data.state); // Add initial state to history
                historyIndex = 0;
            };
        }
    });

    socket.on('user_left', (data) => {
        console.log(`${data.userName} left the room.`);
        // You could add a small toast notification here
    });
});