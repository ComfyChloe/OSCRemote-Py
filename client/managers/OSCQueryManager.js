const { OSCQueryServer, OSCQAccess, OSCTypeSimple } = require('oscquery');
const osc = require('node-osc');

class OSCQueryManager {
    constructor(config) {
        this.config = config;
        this.status = "waiting for input";
        this.parameters = new Map();
        this.messageHandlers = new Set();
        this.oscServer = null;
    }

    async start() {
        try {
            const receivePort = this.config.osc.local.receivePort || 9001;
            const queryPort = this.config.osc.local.queryPort || 9012;
            const ip = this.config.osc.local.ip || '127.0.0.1';

            console.log(`[Client] Setting up OSCQuery with HTTP on port ${queryPort} and OSC on port ${receivePort}`);

            this.oscQueryServer = new OSCQueryServer({
                oscPort: receivePort,
                httpPort: queryPort,
                serviceName: "Chloes-OSCRelay",
                oscTransport: "UDP"
            });

            const oscServerPort = receivePort + 100; 
            this.createOSCServer(oscServerPort, ip);

            this.addVRChatEndpoints();

            this.oscQueryServer.addMethod("/status", {
                description: "Client status string",
                access: OSCQAccess.READONLY,
                arguments: [{ type: OSCTypeSimple.STRING }]
            });
            this.oscQueryServer.setValue("/status", 0, this.status);

            // Add VRChat discovery endpoint
            this.oscQueryServer.addMethod("/vrchat/api/1/config/osc", {
                description: "VRChat OSC configuration request",
                access: OSCQAccess.READWRITE,
                arguments: [{ type: OSCTypeSimple.INT }]
            });

            await this.oscQueryServer.start();
            console.log(`[Client] OSCQuery server started successfully`);
            console.log(`[Client] HTTP discovery available on port ${queryPort}`);
            console.log(`[Client] OSC messages should be sent to port ${receivePort}`);
            console.log(`[Client] Additional OSC server listening on port ${oscServerPort}`);
            
            // Initialize connection with VRChat
            this.sendInitialPingToVRChat();
        } catch (error) {
            console.error(`[Client] Failed to start OSCQuery server: ${error.message}`);
            if (error.code === 'EACCES') {
                console.error(`[Client] Permission denied for port binding. Port may already be in use.`);
                console.error(`[Client] Try changing the receivePort in your configuration or running with admin privileges.`);
            }
            throw error;
        }
    }

    createOSCServer(port, ip) {
        try {
            console.log(`[Client] Setting up additional OSC server on port ${port}`);
            this.oscServer = new osc.Server(port, ip);
            this.oscServer.on('message', (msg, rinfo) => {
                this.handleMessage(msg, rinfo);
            });
        } catch (error) {
            console.error(`[Client] Failed to create additional OSC server: ${error.message}`);
        }
    }

    handleMessage(msg, rinfo) {
        const [address, ...args] = msg;
        const message = { address, args, source: rinfo.address, port: rinfo.port };
        
        let shouldLog = true;
        this.messageHandlers.forEach(handler => {
            const result = handler(message, rinfo);
            if (result === false) {
                shouldLog = false;
            }
        });
        
        if (shouldLog && this.config?.logging?.osc?.incoming) {
            console.log(`[Client] OSC message received: ${address} from ${rinfo.address}:${rinfo.port} [${args.join(', ')}]`);
        }
    }

    addVRChatEndpoints() {
        this.oscQueryServer.addMethod("/avatar/parameters/*", {
            description: "Avatar parameter changes",
            access: OSCQAccess.READWRITE,
            arguments: [{ 
                type: OSCTypeSimple.FLOAT,
                range: { min: 0, max: 1 }
            }]
        });

        const essentialEndpoints = [
            { path: "/avatar/change", desc: "Change avatar" },
            { path: "/avatar/parameters/IsLocal", desc: "Is local player" },
            { path: "/chatbox/input", desc: "VRChat chatbox", arguments: [
                { type: OSCTypeSimple.STRING },
                { type: OSCTypeSimple.BOOL }
            ]}
        ];

        essentialEndpoints.forEach(endpoint => {
            this.oscQueryServer.addMethod(endpoint.path, {
                description: endpoint.desc,
                access: OSCQAccess.READWRITE,
                arguments: endpoint.arguments || [{ 
                    type: OSCTypeSimple.FLOAT,
                    range: { min: 0, max: 1 }
                }]
            });
        });
    }

    sendInitialPingToVRChat() {
        try {
            const client = new osc.Client('127.0.0.1', 9000);
            
            console.log('[Client] Sending initialization pings to VRChat...');
            
            const pingMessages = [
                { address: "/avatar/parameters/MuteSelf", value: 0 },
                { address: "/avatar/parameters/VRCFaceBlendH", value: 0.5 },
                { address: "/avatar/parameters/IsLocal", value: 1 }
            ];
            
            pingMessages.forEach(msg => {
                client.send(msg.address, msg.value);
                console.log(`[Client] Ping: ${msg.address} = ${msg.value}`);
            });
            
            setTimeout(() => {
                client.close();
                console.log('[Client] Initialization sequence completed');
            }, 1000);
        } catch (error) {
            console.error(`[Client] Failed to send initialization ping: ${error.message}`);
        }
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

    send(address, ...args) {
        if (this.oscQueryServer) {
            try {
                this.oscQueryServer.send(address, ...args);
            } catch (error) {
                console.error(`[Client] Failed to send message via OSCQuery: ${error.message}`);
            }
        }
    }

    close() {
        if (this.oscServer) {
            try {
                this.oscServer.close();
                console.log('[Client] Additional OSC server closed');
            } catch (error) {
                console.error(`[Client] Error closing additional OSC server: ${error.message}`);
            }
        }
        
        if (this.oscQueryServer) {
            try {
                if (typeof this.oscQueryServer.stop === 'function') {
                    this.oscQueryServer.stop();
                    console.log('[Client] OSCQuery server stopped');
                } 
                else if (typeof this.oscQueryServer.shutdown === 'function') {
                    this.oscQueryServer.shutdown();
                    console.log('[Client] OSCQuery server shutdown');
                }
                else if (typeof this.oscQueryServer.dispose === 'function') {
                    this.oscQueryServer.dispose();
                    console.log('[Client] OSCQuery server disposed');
                }
                else {
                    console.log('[Client] No shutdown method found for OSCQuery server');
                }
            } catch (error) {
                console.error(`[Client] Error closing OSCQuery server: ${error.message}`);
            }
        }
    }
}

module.exports = OSCQueryManager;
