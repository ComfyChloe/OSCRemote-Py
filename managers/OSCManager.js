const osc = require('node-osc');

class OSCManager {
    constructor(config) {
        this.config = config;
        this.receivers = new Map();
        this.senders = new Map();
        this.messageHandlers = new Set();

        // Create default sender for VRChat
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
            throw err;
        }
    }

    handleMessage(msg, rinfo) {
        const [address, ...args] = msg;
        console.log(`[Client] | Local IP: ${rinfo.address} | Received OSC: ${address} | [${args.map(arg => JSON.stringify(arg)).join(', ')}]`);
        
        this.messageHandlers.forEach(handler => 
            handler({ address, args, source: rinfo.address }));
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
            console.log(`[Client] | Sending OSC to port ${port}: ${address} | [${args.map(arg => JSON.stringify(arg)).join(', ')}]`);
            sender.send(address, ...args);
        }
    }
}

module.exports = OSCManager;