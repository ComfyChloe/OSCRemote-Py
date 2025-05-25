const osc = require('node-osc');

class OSCManager {
    constructor(config) {
        this.config = config;
        this.receivers = new Map();
        this.senders = new Map();
        this.messageHandlers = new Set();

        if (config?.osc?.local?.sendPort) {
            this.createSender(config.osc.local.sendPort);
        }
    }

    createReceiver(port) {
        return new Promise((resolve, reject) => {
            try {
                const server = new osc.Server(port, '127.0.0.1');
                server.on('listening', () => {
                    this.receivers.set(port, server);
                    console.log(`[Server] OSC receiver listening on port ${port}`);
                    resolve(port);
                });
                server.on('message', this.handleMessage.bind(this));
                server.on('error', reject);
            } catch (err) {
                reject(err);
            }
        });
    }

    createSender(port) {
        try {
            const client = new osc.Client('127.0.0.1', port);
            this.senders.set(port, client);
            return client;
        } catch (err) {
            console.error('[Server] Failed to create OSC sender:', err);
            throw err;
        }
    }

    handleMessage(msg, rinfo) {
        const [address, ...args] = msg;
        const message = { address, args, source: rinfo.address, port: rinfo.port };
        
        let shouldProcess = true;
        let shouldLog = true;
        
        this.messageHandlers.forEach(handler => {
            const result = handler(message);
            if (result === false) {
                shouldProcess = false;
                shouldLog = false;
            }
        });

        if (shouldLog && this.config?.logging?.osc?.incoming && shouldProcess) {
            console.log(`[Server] | Local IP: ${rinfo.address} | Received OSC: ${address} | [${args.join(', ')}]`);
        }
    }

    onMessage(handler) {
        this.messageHandlers.add(handler);
    }

    send(port, address, ...args) {
        let sender = this.senders.get(port);
        if (!sender) {
            sender = this.createSender(port);
        }
        if (sender) {
            if (this.config?.logging?.osc?.outgoing) {
                console.log(`[Server] | Sending OSC to port ${port}: ${address} | [${args.join(', ')}]`);
            }
            sender.send(address, ...args);
        }
    }
}

module.exports = OSCManager;
