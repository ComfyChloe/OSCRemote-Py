const fs = require('fs');
const path = require('path');

class Logger {
    constructor() {
        this.setLogPath('logs');
        this.verbose = true;
        this.loggedMessages = new Set(); // Track recent messages to avoid duplicates
        this.messageTTL = 5000; // Time in ms to remember messages to prevent duplication
    }

    setLogPath(logPath) {
        this.logPath = logPath;
        this.logFile = path.join(logPath, `osc_relay_${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
        
        if (!fs.existsSync(logPath)) {
            fs.mkdirSync(logPath, { recursive: true });
        }
    }

    setVerbose(verbose) {
        this.verbose = verbose;
    }

    log(message, type = 'INFO', skipConsole = false) {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] [${type}] ${message}\n`;

        // Always write to file
        fs.appendFileSync(this.logFile, logMessage);
        
        // Check if this is a duplicate message within our TTL window
        const messageKey = `${type}:${message}`;
        if (!skipConsole && !this.isDuplicate(messageKey)) {
            console.log(message);
        }
    }
    
    isDuplicate(messageKey) {
        if (this.loggedMessages.has(messageKey)) {
            return true;
        }
        
        // Add to our tracking set and schedule removal
        this.loggedMessages.add(messageKey);
        setTimeout(() => {
            this.loggedMessages.delete(messageKey);
        }, this.messageTTL);
        
        return false;
    }
    
    discovery(action, service) {
        const name = service.name || 'Unknown';
        const host = service.host || 'Unknown';
        const port = service.port || 'Unknown';
        
        const message = `OSCQuery service ${action === 'up' ? 'discovered' : 'lost'}: ${name} at ${host}:${port}`;
        this.log(message, 'DISCOVERY');
    }
    
    info(component, message) {
        this.log(`[${component}] ${message}`, 'INFO');
    }
    
    error(component, message) {
        this.log(`[${component}] ERROR: ${message}`, 'ERROR');
    }
    
    debug(component, message) {
        if (this.verbose) {
            this.log(`[${component}] DEBUG: ${message}`, 'DEBUG');
        } else {
            // Still log to file but skip console
            this.log(`[${component}] DEBUG: ${message}`, 'DEBUG', true);
        }
    }
}

module.exports = new Logger();
