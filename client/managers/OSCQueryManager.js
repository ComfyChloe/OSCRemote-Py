const { OSCQueryServer, OSCQAccess, OSCTypeSimple, OSCQueryDiscovery } = require('oscquery');
const osc = require('node-osc');
const logger = require('./logger');

class OSCQueryManager {
    constructor(config) {
        this.config = config;
        this.status = "waiting for input";
        this.parameters = new Map();
        this.messageHandlers = new Set();
        this.oscClient = null;
        this.discoveredServices = [];
        this.discovery = null;
        this.oscQueryServer = null;
        this.oscSender = null;
    }

    async start() {
        try {
            // Get configuration values
            const receivePort = this.config.osc.local.receivePort || 9037;
            const queryPort = this.config.osc.local.queryPort || 34812;
            const sendPort = this.config.osc.local.sendPort || 9000;
            const ip = this.config.osc.local.ip || '127.0.0.1';
            
            logger.info('Client', `Setting up OSCQuery with HTTP on port ${queryPort} and advertising OSC on port ${receivePort}`);

            // Create the OSCQueryServer with our service information
            this.oscQueryServer = new OSCQueryServer({
                // The HTTP server will run on this port
                httpPort: queryPort,
                // Tell clients our OSC server listens on this port
                oscPort: receivePort,
                // Give our service a name for discovery
                serviceName: "Chloes-OSCRelay",
                // Use UDP for OSC communication
                oscTransport: "UDP"
            });

            // Create OSC client to send messages to VRChat
            this.oscSender = new osc.Client('127.0.0.1', sendPort);
            logger.info('Client', `Created OSC client to send to VRChat on port ${sendPort}`);

            // Register our methods in the OSCQuery namespace
            this.addEndpoints();

            // Start the HTTP server for OSCQuery
            await this.oscQueryServer.start();
            logger.info('Client', `OSCQuery server started successfully on HTTP port ${queryPort}`);
            logger.info('Client', `Advertising OSC service on port ${receivePort}`);
            
            // Start OSCQuery discovery to find other services (like VRChat)
            this.startDiscovery();
        } catch (error) {
            logger.error('Client', `Failed to start OSCQuery server: ${error.message}`);
            throw error;
        }
    }

    startDiscovery() {
        try {
            logger.info('Client', 'Starting OSCQuery discovery service');
            this.discovery = new OSCQueryDiscovery();
            
            this.discovery.on('up', (service) => {
                // Only log once to avoid duplication - the client will handle detailed logging
                logger.debug('Client', `OSCQuery service discovered: ${service.name || 'Unknown'}`);
                
                this.discoveredServices.push(service);
                
                // Notify listeners about the discovered service
                this.messageHandlers.forEach(handler => {
                    handler({
                        type: 'oscquery_discovery',
                        action: 'up',
                        service: {
                            name: service.name,
                            host: service.host,
                            port: service.port,
                            oscPort: service.oscPort
                        }
                    });
                });
                
                // If this is VRChat, we can set up to receive from it
                if (service.name && service.name.toLowerCase().includes('vrchat')) {
                    logger.info('Client', `VRChat OSCQuery service found at ${service.host}:${service.oscPort}`);
                    this.setupVRChatConnection(service);
                }
            });
            
            this.discovery.on('down', (service) => {
                // Only log once - let the client handle detailed logging
                logger.debug('Client', `OSCQuery service lost: ${service.name || 'Unknown'}`);
                
                this.discoveredServices = this.discoveredServices.filter(s => 
                    !(s.host === service.host && s.port === service.port));
                
                // Notify listeners about the lost service
                this.messageHandlers.forEach(handler => {
                    handler({
                        type: 'oscquery_discovery',
                        action: 'down',
                        service: {
                            name: service.name,
                            host: service.host,
                            port: service.port
                        }
                    });
                });
            });
            
            this.discovery.start();
            logger.info('Client', 'OSCQuery discovery started');
        } catch (error) {
            logger.error('Client', `Failed to start OSCQuery discovery: ${error.message}`);
        }
    }
    
    setupVRChatConnection(service) {
        try {
            // VRChat will send OSC messages to our advertised port (receivePort)
            // We don't need to create an explicit connection to it
            logger.info('Client', `VRChat will send OSC to our advertised port ${this.config.osc.local.receivePort}`);
            
            // Send an initial ping to VRChat to make sure it's working
            this.sendInitialPingToVRChat();
        } catch (error) {
            logger.error('Client', `Error setting up VRChat connection: ${error.message}`);
        }
    }
    
    addEndpoints() {
        // Add status endpoint
        this.oscQueryServer.addMethod("/status", {
            description: "Client status string",
            access: OSCQAccess.READONLY,
            arguments: [{ type: OSCTypeSimple.STRING }]
        });
        this.oscQueryServer.setValue("/status", 0, this.status);
        
        // Add VRChat endpoints
        this.addVRChatEndpoints();
    }

    addVRChatEndpoints() {
        // Wildcard for all avatar parameters
        this.oscQueryServer.addMethod("/avatar/parameters/*", {
            description: "Avatar parameter changes",
            access: OSCQAccess.READWRITE,
            arguments: [{ 
                type: OSCTypeSimple.FLOAT,
                range: { min: 0, max: 1 }
            }]
        });

        // Essential VRChat endpoints
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
        
        // Add VRChat discovery endpoint
        this.oscQueryServer.addMethod("/vrchat/api/1/config/osc", {
            description: "VRChat OSC configuration request",
            access: OSCQAccess.READWRITE,
            arguments: [{ type: OSCTypeSimple.INT }]
        });
    }

    sendInitialPingToVRChat() {
        try {
            logger.info('Client', 'Sending initialization pings to VRChat...');
            
            const pingMessages = [
                { address: "/avatar/parameters/MuteSelf", value: 0 },
                { address: "/avatar/parameters/VRCFaceBlendH", value: 0.5 },
                { address: "/avatar/parameters/IsLocal", value: 1 }
            ];
            
            pingMessages.forEach(msg => {
                if (this.oscSender) {
                    this.oscSender.send(msg.address, msg.value);
                    logger.debug('Client', `Ping: ${msg.address} = ${msg.value}`);
                }
            });
            
            logger.info('Client', 'Initialization sequence completed');
        } catch (error) {
            logger.error('Client', `Failed to send initialization ping: ${error.message}`);
        }
    }
    
    stopDiscovery() {
        if (this.discovery) {
            try {
                this.discovery.stop();
                logger.info('Client', 'OSCQuery discovery stopped');
            } catch (error) {
                logger.error('Client', `Error stopping OSCQuery discovery: ${error.message}`);
            }
        }
    }
    
    getDiscoveredServices() {
        if (this.discovery) {
            return this.discovery.getServices();
        }
        return this.discoveredServices;
    }
    
    async queryServiceManually(address, port) {
        if (this.discovery) {
            try {
                const service = await this.discovery.queryNewService(address, port);
                logger.info('Client', `Manually queried service: ${service.name} at ${service.host}:${service.port}`);
                return service;
            } catch (error) {
                logger.error('Client', `Error querying service manually: ${error.message}`);
                throw error;
            }
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
        if (this.oscSender) {
            try {
                this.oscSender.send(address, ...args);
                logger.debug('Client', `Sent OSC message: ${address} [${args.join(', ')}]`);
            } catch (error) {
                logger.error('Client', `Failed to send OSC message: ${error.message}`);
            }
        }
    }

    close() {
        // Stop discovery
        this.stopDiscovery();
        
        // Close OSC sender
        if (this.oscSender) {
            try {
                this.oscSender.close();
                logger.info('Client', 'OSC sender closed');
            } catch (error) {
                logger.error('Client', `Error closing OSC sender: ${error.message}`);
            }
        }
        
        // Close OSCQuery server
        if (this.oscQueryServer) {
            try {
                if (typeof this.oscQueryServer.stop === 'function') {
                    this.oscQueryServer.stop();
                    logger.info('Client', 'OSCQuery server stopped');
                } 
                else {
                    logger.info('Client', 'No direct stop method found for OSCQuery server');
                }
            } catch (error) {
                logger.error('Client', `Error closing OSCQuery server: ${error.message}`);
            }
        }
    }
}

module.exports = OSCQueryManager;
