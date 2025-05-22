const http = require('http');

class OSCQueryManager {
    constructor(config) {
        this.config = config;
        this.parameters = new Map();
        this.queryPort = config?.osc?.local?.queryPort || 9012;
    }

    start() {
        return new Promise((resolve, reject) => {
            this.createQueryServer(this.queryPort, resolve, reject);
        });
    }

    createQueryServer(port, resolve, reject) {
        try {
            this.server = http.createServer(this.handleQuery.bind(this));
            
            this.server.on('error', (err) => {
                if (err.code === 'EADDRINUSE') {
                    this.createQueryServer(port + 1, resolve, reject);
                } else {
                    reject(err);
                }
            });

            this.server.listen(port, '127.0.0.1', () => {
                console.log(`[OSCQuery] Server listening on port ${port}`);
                resolve(port);
            });
        } catch (err) {
            reject(err);
        }
    }

    handleQuery(req, res) {
        const response = {
            DESCRIPTION: "OSC Relay Query Server",
            HOST_INFO: {
                NAME: "OSCRelay",
                OSC_TRANSPORT: "UDP",
                OSC_IP: "127.0.0.1",
                OSC_PORT: this.config.osc.local.sendPort
            },
            PARAMETERS: Object.fromEntries(this.parameters)
        };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));
    }

    updateParameter(address, value, type) {
        this.parameters.set(address, { value, type });
    }
}

module.exports = OSCQueryManager;