document.addEventListener('DOMContentLoaded', () => {
    // ... (All the welcome message, logout, and back button logic is identical to js/room.js) ...

    createRoomBtn.addEventListener('click', () => {
        const roomCode = Math.floor(1000 + Math.random() * 9000).toString();
        // ... (modal logic is the same) ...
        setTimeout(() => {
            // --- THIS IS THE ONLY CHANGE ---
            window.location.href = `watch.html?room=${roomCode}`;
        }, 2500);
    });

    joinRoomBtn.addEventListener('click', () => {
        const roomCode = roomCodeInput.value.trim();
        if (roomCode.length === 4 && !isNaN(roomCode)) {
            // --- THIS IS THE ONLY CHANGE ---
            window.location.href = `watch.html?room=${roomCode}`;
        } else {
            alert('Please enter a valid 4-digit room code.');
        }
    });

    // ... (rest of the modal/copy code is identical) ...
});
