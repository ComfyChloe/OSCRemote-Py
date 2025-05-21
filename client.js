const WebSocket = require('ws');

class OSCRelayClient {
    constructor(serverUrl) {
        this.serverUrl = serverUrl;
        this.ws = null;
        this.messageHandlers = new Set();
        this.filters = new Set();
    }

    connect() {
        this.ws = new WebSocket(this.serverUrl);

        this.ws.on('open', () => {
            console.log('Connected to OSC relay');
        });

        this.ws.on('message', (data) => {
            const message = JSON.parse(data);
            if (this.shouldProcessMessage(message)) {
                this.messageHandlers.forEach(handler => handler(message));
            }
        });

        this.ws.on('close', () => {
            console.log('Disconnected from OSC relay');
            setTimeout(() => this.connect(), 5000);
        });
    }

    send(address, ...args) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            const message = { address, args };
            if (this.shouldProcessMessage(message)) {
                this.ws.send(JSON.stringify(message));
            }
        }
    }

    onMessage(handler) {
        this.messageHandlers.add(handler);
    }

    addFilter(pattern) {
        this.filters.add(pattern);
    }

    shouldProcessMessage(message) {
        if (this.filters.size === 0) return true;
        return Array.from(this.filters).some(pattern => 
            message.address.match(new RegExp(pattern)));
    }
}

module.exports = OSCRelayClient;
