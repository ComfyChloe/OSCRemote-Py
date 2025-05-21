const OSCRelayClient = require('./client');
const net = require('net');

const SERVER_HOST = '57.128.188.155';
const SERVER_PORT = 4953;
const LOCAL_TEST_PORT = 9100;

async function runOSCTests() {
    const client = new OSCRelayClient(`ws://${SERVER_HOST}:${SERVER_PORT}`);

    try {
        client.onMessage(message => {
            console.log('[Test Client] Received OSC Message:', {
                timestamp: new Date().toISOString(),
                source: message.source || 'unknown',
                address: message.address,
                args: message.args
            });
        });

        console.log(`[Test Client] Connecting to ${SERVER_HOST}:${SERVER_PORT}...`);
        await client.connect();

        if (client.connected) {
            const testCases = [
                { path: '/avatar/parameters/Voice', value: 0.75 },
                { path: '/avatar/parameters/VRCEmote', value: 1 },
            ];

            console.log('[Test Client] Running test cases...');
            for (const test of testCases) {
                await new Promise(resolve => setTimeout(resolve, 500));
                client.send(test.path, test.value);
                console.log(`[Test Client] Sent: ${test.path} = ${test.value}`);
            }
        }
    } catch (error) {
        console.error('[Test Client] Error:', error.message);
        process.exit(1);
    }
}

console.log(`[Test Client] Checking server availability...`);
const testConnection = net.connect({ 
    host: SERVER_HOST, 
    port: SERVER_PORT 
}, () => {
    console.log('[Test Client] Server is available');
    testConnection.end();
    runOSCTests().catch(console.error);
});

testConnection.on('error', (err) => {
    console.error(`[Test Client] Server check failed: ${err.message}`);
    process.exit(1);
});
