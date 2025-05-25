const osc = require('node-osc');

class OSCManager {
    constructor(config) {
        this.config = config;
        this.receivers = new Map();
        this.senders = new Map();
        this.messageHandlers = new Set();

        if (config?.osc?.local?.sendPort) {
            this.createSender(config.osc.local.sendPort, config.osc.local.ip || '127.0.0.1');
        }
    }

    createReceiver(port, host = this.config?.osc?.local?.ip || '127.0.0.1') {
        return new Promise((resolve, reject) => {
            try {
                const server = new osc.Server(port, host);
                server.on('listening', () => {
                    this.receivers.set(port, server);
                    console.log(`[Client] OSC receiver listening on ${host}:${port}`);
                    resolve(port);
                });
                server.on('message', this.handleMessage.bind(this));
                server.on('error', (err) => {
                    reject(err);
                });
            } catch (err) {
                reject(err);
            }
        });
    }

    createSender(port, host = this.config?.osc?.local?.ip || '127.0.0.1') {
        try {
            const client = new osc.Client(host, port);
            this.senders.set(port, client);
            return client;
        } catch (err) {
            console.error('[Client] Failed to create OSC sender:', err);
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
            console.log(`[Client] | Local IP: ${rinfo.address} | Received OSC: ${address} | [${args.join(', ')}]`);
        }
    }

    onMessage(handler) {
        this.messageHandlers.add(handler);
    }

    send(port, address, ...args) {
        if (!port) {
            console.error('[Client] OSC send error: No port specified');
            return;
        }
        let sender = this.senders.get(port);
        if (!sender) {
            sender = this.createSender(port);
        }
        if (sender) {
            if (this.config?.logging?.osc?.outgoing) {
                console.log(`[Client] | Sending OSC to port ${port}: ${address} | [${args.join(', ')}]`);
            }
            sender.send(address, ...args);
        }
    }
}

module.exports = OSCManager;
