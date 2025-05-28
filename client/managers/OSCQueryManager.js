const { OSCQueryServer, OSCQAccess, OSCTypeSimple } = require('oscquery');
const osc = require('node-osc');

class OSCQueryManager {
    constructor(config) {
        this.config = config;
        this.status = "waiting for input";
        this.parameters = new Map();
        this.messageHandlers = new Set();
    }

    async start() {
        const receivePort = this.config.osc.local.receivePort || 9001;
        const queryPort = this.config.osc.local.queryPort || 36455;
        const ip = this.config.osc.local.ip || '127.0.0.1';

        this.oscQueryServer = new OSCQueryServer({
            oscPort: receivePort,
            httpPort: queryPort,
            serviceName: "Chloes-OSCRelay",
            oscTransport: "UDP"
        });

        const server = new osc.Server(receivePort, ip);
        server.on('message', this.handleMessage.bind(this));

        // Add OSC endpoints that VRChat can discover
        this.oscQueryServer.addMethod("/avatar/parameters/*", {
            description: "Avatar parameter changes",
            access: OSCQAccess.READWRITE,
            arguments: [{ 
                type: OSCTypeSimple.FLOAT,
                range: { min: 0, max: 1 }
            }]
        });

        // Add status endpoint
        this.oscQueryServer.addMethod("/status", {
            description: "Client status string",
            access: OSCQAccess.READONLY,
            arguments: [{ type: OSCTypeSimple.STRING }]
        });
        this.oscQueryServer.setValue("/status", 0, this.status);

        await this.oscQueryServer.start();
        console.log(`[Client] OSCQuery server started on port ${queryPort}, listening for OSC on ${receivePort}`);
    }

    handleMessage(msg, rinfo) {
        const [address, ...args] = msg;
        const message = { address, args, source: rinfo.address, port: rinfo.port };
        this.messageHandlers.forEach(handler => handler(message, rinfo));
    }

    onMessage(handler) {
        this.messageHandlers.add(handler);
    }

    setStatus(status) {
        this.status = status;
        if (this.oscQueryServer) {
            this.oscQueryServer.setValue("/status", 0, status);
        }
    }
}

module.exports = OSCQueryManager;
