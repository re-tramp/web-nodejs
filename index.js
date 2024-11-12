const net = require("net");
const WebSocket = require("ws");

// Logging functions
const log = (...args) => console.log(...args);
const error = (...args) => console.error(...args);

// Configuration
const uuid = (
    process.env.UUID || "f65c45c4-08c0-49f4-a2bf-aed46e0c008a"
).replace(/-/g, "");
const port = process.env.PORT || 8080;

// Create WebSocket server
const wss = new WebSocket.Server({ port }, () =>
    log("Listening on port:", port),
);

wss.on("connection", (ws) => {
    log("Client connected");

    ws.once("message", (msg) => {
        const [VERSION] = msg;
        const id = msg.slice(1, 17);

        // Validate UUID
        if (!id.every((v, i) => v === parseInt(uuid.substr(i * 2, 2), 16)))
            return;

        let i = msg.slice(17, 18).readUInt8() + 19;
        const targetPort = msg.slice(i, (i += 2)).readUInt16BE(0);
        const ATYP = msg.slice(i, (i += 1)).readUInt8();

        // Determine host based on address type
        let host;
        if (ATYP === 1) {
            // IPv4
            host = msg.slice(i, (i += 4)).join(".");
        } else if (ATYP === 2) {
            // Domain
            const len = msg.slice(i, i + 1).readUInt8();
            host = new TextDecoder().decode(msg.slice(i + 1, (i += 1 + len)));
        } else if (ATYP === 3) {
            // IPv6
            host = msg
                .slice(i, (i += 16))
                .reduce(
                    (s, b, j, a) =>
                        j % 2 ? s.concat(a.slice(j - 1, j + 1)) : s,
                    [],
                )
                .map((b) => b.readUInt16BE(0).toString(16))
                .join(":");
        }

        log("Connecting to:", host, targetPort);

        // Send acknowledgment to client
        ws.send(new Uint8Array([VERSION, 0]));

        // Create a duplex stream
        const duplex = WebSocket.createWebSocketStream(ws);

        // Connect to target server
        net.connect({ host, port: targetPort }, function () {
            this.write(msg.slice(i)); // Send remaining message data
            duplex
                .on("error", error.bind(null, "Duplex error:"))
                .pipe(this)
                .on("error", error.bind(null, "Socket error:"))
                .pipe(duplex);
        }).on(
            "error",
            error.bind(null, "Connection error:", { host, port: targetPort }),
        );
    }).on("error", error.bind(null, "WebSocket error:"));
});
