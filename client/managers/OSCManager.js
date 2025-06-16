const osc = require('node-osc');
const logger = require('./logger');

class OSCManager {
    constructor(config) {
        this.config = config;
        this.senders = new Map();
        this.messageHandlers = new Set();
        this.oscServer = null;
        this.setupOSCServer();
    }

    setupOSCServer() {
        try {
            const port = this.config.osc.local.receivePort || 9001;
            const ip = this.config.osc.local.ip || '127.0.0.1';
            
            logger.info('Client', `Setting up OSC server on port ${port}`);
            this.oscServer = new osc.Server(port, ip);
            
            this.oscServer.on('message', (msg, rinfo) => {
                const [address, ...args] = msg;
                const message = { address, args, source: rinfo.address };
                
                // Let handlers determine if this should be logged based on blacklist
                let shouldLog = true;
                this.messageHandlers.forEach(handler => {
                    // If any handler returns false, don't log
                    if (handler(message) === false) {
                        shouldLog = false;
                    }
                });
                
                // Only log if not blacklisted
                if (shouldLog && this.config?.logging?.osc?.incoming) {
                    logger.debug('Client', `OSC received from ${rinfo.address}:${rinfo.port}: ${address} [${args.join(', ')}]`);
                }
            });
            
            logger.info('Client', `OSC server listening on ${ip}:${port}`);
        } catch (error) {
            logger.error('Client', `Failed to create OSC server: ${error.message}`);
            if (error.code === 'EADDRINUSE') {
                logger.error('Client', `Port ${this.config.osc.local.receivePort} is already in use`);
                logger.error('Client', `OSCQuery functionality will still work, but direct OSC reception on this port will not.`);
            }
        }
    }

    createSender(port, host = this.config?.osc?.local?.ip || '127.0.0.1') {
        try {
            const client = new osc.Client(host, port);
            this.senders.set(port, client);
            logger.info('Client', `Created OSC sender to ${host}:${port}`);
            return client;
        } catch (err) {
            logger.error('Client', `Failed to create OSC sender: ${err.message}`);
            throw err;
        }
    }

    send(port, address, ...args) {
        if (!port) {
            logger.error('Client', 'OSC send error: No port specified');
            return;
        }
        let sender = this.senders.get(port);
        if (!sender) {
            sender = this.createSender(port);
        }
        if (sender) {
            const processedArgs = args.map(arg => {
                if (typeof arg === 'boolean') {
                    return arg ? 1 : 0;
                }
                return arg;
            });
            
            const shouldLog = this.shouldLogMessage({ address, args: processedArgs });
            
            if (shouldLog && this.config?.logging?.osc?.outgoing === true) {
                logger.debug('Client', `Sending OSC to port ${port}: ${address} [${processedArgs.join(', ')}]`);
            }
            sender.send(address, ...processedArgs);
        }
    }
    
    shouldLogMessage(message) {
        if (!this.config?.filters?.blacklist?.console) {
            return true;
        }
        
        const blacklist = this.config.filters.blacklist.console || [];
        return !blacklist.some(pattern => {
            try {
                const regex = new RegExp(pattern.replace('*', '.*'));
                return regex.test(message.address);
            } catch (err) {
                logger.warn('Client', `Invalid blacklist pattern: ${pattern}`);
                return false;
            }
        });
    }

    onMessage(handler) {
        this.messageHandlers.add(handler);
    }

    close() {
        if (this.oscServer) {
            try {
                this.oscServer.close();
                logger.info('Client', 'OSC server closed');
            } catch (error) {
                logger.error('Client', `Error closing OSC server: ${error.message}`);
            }
        }
        
        for (const [port, sender] of this.senders.entries()) {
            try {
                sender.close();
                logger.info('Client', `OSC sender to port ${port} closed`);
            } catch (error) {
                logger.error('Client', `Error closing OSC sender to port ${port}: ${error.message}`);
            }
        }
    }
}

module.exports = OSCManager;
