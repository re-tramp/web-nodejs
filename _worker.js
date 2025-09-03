// src/index.js

export default {
    async fetch(request, env, ctx) {
        // 从环境变量中获取 UUID，如果未设置，则使用代码中的默认值
        const userID = env.UUID || 'f65c45c4-08c0-49f4-a2bf-aed46e0c008a';
        
        const url = new URL(request.url);

        // 处理 WebSocket 升级请求
        if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
            return handleWebSocket(request, userID);
        }

        // 处理所有其他的 HTTP GET 请求，进行重定向
        if (request.method === 'GET') {
            // 你可以自定义重定向的目标地址
            return Response.redirect('https://news.google.com', 302);
        }

        // 对于非 GET 请求或不符合条件的请求，返回 404
        return new Response('Not found', { status: 404 });
    },
};

/**
 * 处理 WebSocket 请求
 * @param {Request} request
 * @param {string} userID 用户的 UUID
 */
async function handleWebSocket(request, userID) {
    const { readable, writable } = new WebSocketStream(new WebSocketPair()[0]);
    const earlyData = request.headers.get('sec-websocket-protocol') || '';

    handleVLESSConnection({
        readable,
        writable,
        earlyData,
        userID,
    }).catch(err => {
        console.error('VLESS connection error:', err);
    });

    return new Response(null, {
        status: 101,
        webSocket: new WebSocketPair()[1],
    });
}

/**
 * 处理 VLESS 协议的连接
 * @param {*} vlessConfig
 */
async function handleVLESSConnection({ readable, writable, earlyData, userID }) {
    const vlessReader = readable.getReader();
    const vlessWriter = writable.getWriter();
    
    let remoteSocket;

    vlessReader.read().then(async ({ value, done }) => {
        if (done) return;
        
        const vlessBuffer = value;
        const reqId = vlessBuffer.subarray(1, 17).toString('hex');
        
        // 验证 UUID
        if (reqId !== userID.replace(/-/g, '')) {
            console.log(`Invalid UUID: ${reqId}`);
            return;
        }

        let offset = vlessBuffer.readUInt8(17) + 19;
        const targetPort = vlessBuffer.readUInt16BE(offset);
        offset += 2;
        const addressType = vlessBuffer.readUInt8(offset++);

        let targetHost = '';
        switch (addressType) {
            case 1: // IPv4
                targetHost = Array.from(vlessBuffer.subarray(offset, offset += 4)).join('.');
                break;
            case 2: // Domain
                const domainLength = vlessBuffer[offset];
                offset += 1;
                targetHost = new TextDecoder().decode(vlessBuffer.subarray(offset, offset += domainLength));
                break;
            case 3: // IPv6
                targetHost = Array.from(vlessBuffer.subarray(offset, offset += 16))
                    .map((b, i, arr) => (i % 2 === 0 ? arr.slice(i, i + 2).readUInt16BE(0).toString(16) : null))
                    .filter(Boolean).join(':');
                break;
            default:
                console.log(`Invalid address type: ${addressType}`);
                return;
        }
        
        // 确认版本号并发送响应
        await vlessWriter.write(new Uint8Array([vlessBuffer[0], 0]));

        // 与目标地址建立 TCP 连接
        remoteSocket = await connect({ hostname: targetHost, port: targetPort });
        
        // 将剩余的数据写入远程 socket
        const restData = vlessBuffer.subarray(offset);
        if (restData.byteLength > 0) {
            await remoteSocket.writable.getWriter().write(restData);
        }

        // 双向管道传输数据
        await Promise.all([
            remoteSocket.readable.pipeTo(writable, { preventClose: true }),
            readable.pipeTo(remoteSocket.writable, { preventClose: true }),
        ]);

    }).catch(err => {
        console.error('VLESS read error:', err);
    });
}
