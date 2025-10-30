function setupDrawPage() {
  const canvas = document.getElementById("board");
  const ctx = canvas.getContext("2d");
  const socket = io();

  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const colorPicker = document.getElementById("colorPicker");
  const undoBtn = document.getElementById("undo");
  const clearBtn = document.getElementById("clear");
  const saveBtn = document.getElementById("save");

  let drawing = false;
  let strokes = [];
  let currentColor = "#000";
  const roomId = localStorage.getItem("roomId");

  socket.emit("joinRoom", roomId);

  colorPicker.oninput = (e) => (currentColor = e.target.value);

  // Helper function
  function drawLine(x, y, color, emit = false) {
    ctx.lineTo(x, y);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
    if (emit) socket.emit("draw", { x, y, color });
  }

  // --- Mouse Events ---
  canvas.addEventListener("mousedown", (e) => {
    drawing = true;
    ctx.beginPath();
    ctx.moveTo(e.clientX, e.clientY);
  });

  canvas.addEventListener("mousemove", (e) => {
    if (!drawing) return;
    drawLine(e.clientX, e.clientY, currentColor, true);
  });

  canvas.addEventListener("mouseup", () => {
    drawing = false;
    ctx.closePath();
    strokes.push(canvas.toDataURL());
  });

  // --- Touch Events (for phones/tablets) ---
  canvas.addEventListener("touchstart", (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    drawing = true;
    ctx.beginPath();
    ctx.moveTo(touch.clientX, touch.clientY);
  });

  canvas.addEventListener("touchmove", (e) => {
    e.preventDefault();
    if (!drawing) return;
    const touch = e.touches[0];
    drawLine(touch.clientX, touch.clientY, currentColor, true);
  });

  canvas.addEventListener("touchend", (e) => {
    drawing = false;
    ctx.closePath();
    strokes.push(canvas.toDataURL());
  });

  // --- Undo ---
  undoBtn.onclick = () => {
    if (strokes.length > 0) {
      strokes.pop();
      const img = new Image();
      const last = strokes[strokes.length - 1];
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (last) {
        img.src = last;
        img.onload = () => ctx.drawImage(img, 0, 0);
      }
    }
  };

  // --- Clear ---
  clearBtn.onclick = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    socket.emit("clearCanvas");
  };

  socket.on("clearCanvas", () => ctx.clearRect(0, 0, canvas.width, canvas.height));

  // --- Save ---
  saveBtn.onclick = () => {
    const link = document.createElement("a");
    link.download = "TwinCanvas.png";
    link.href = canvas.toDataURL();
    link.click();
  };

  // --- Remote draw sync ---
  socket.on("draw", (data) => {
    ctx.lineTo(data.x, data.y);
    ctx.strokeStyle = data.color;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
  });
}
