const axios = require('axios');

const FLY_API_TOKEN = 'FlyV1 fm2_lJPECAAAAAAACE/6xBCbHV2J/+slwuFjJqNd7+Q+wrVodHRwczovL2FwaS5mbHkuaW8vdjGWAJLOAA8BxR8Lk7lodHRwczovL2FwaS5mbHkuaW8vYWFhL3YxxDzW+yk+JbujyHtrVT3YBSBcXj/9KlxI0zX1N6SRPxtpVYu8mterWltGkkwVSrNqniwY4AVoJ4V+/y/8+dzETiEBgP1PE522/4iykqTR+FbiqLbXdwD8+I7I6fO1zG8KYYZPR5x22x9rsoNoeyDegAuUJAI8Ff4cilAkHdK1II3zC9etXObfz5Gzv0T8hQ2SlAORgc4AaCY2HwWRgqdidWlsZGVyH6J3Zx8BxCAn4IfxKRrTJFCVbgyg1oK0R6D5HmrK4nYIBcjjA0LvZw==,fm2_lJPETiEBgP1PE522/4iykqTR+FbiqLbXdwD8+I7I6fO1zG8KYYZPR5x22x9rsoNoeyDegAuUJAI8Ff4cilAkHdK1II3zC9etXObfz5Gzv0T8hcQQeUOt4Bt/TIxVYSlqVIgltMO5aHR0cHM6Ly9hcGkuZmx5LmlvL2FhYS92MZgEks5nxLT2zwAAAAEjvNMUF84ADm7FCpHOAA5uxQzEEDse4wGquZtRlIaxZXDXBD3EIIffOUcYbTHKr9XdWZnHpi6KYOc4ixWxqEyC85r/lUOQ'; // Pegue com flyctl auth token
const APP_NAME = 'botzin';
const MACHINE_IDS = ['7815727f9d7228', '2874551a043528']; // Suas máquinas em gru
const BOT_URL = 'https://botzin.fly.dev/';

async function checkAndKeepAlive() {
    try {
        const response = await axios.get(BOT_URL);
        console.log(`[${new Date().toISOString()}] Bot online - Status: ${response.status}`);
    } catch (err) {
        console.log(`[${new Date().toISOString()}] Bot offline (${err.message}), reiniciando...`);
        for (const machineId of MACHINE_IDS) {
            try {
                await axios.post(`https://api.fly.io/v1/apps/${APP_NAME}/machines/${machineId}/restart`, {}, {
                    headers: { Authorization: `Bearer ${FLY_API_TOKEN}` }
                });
                console.log(`Máquina ${machineId} reiniciada com sucesso.`);
            } catch (restartErr) {
                console.log(`Erro ao reiniciar ${machineId}: ${restartErr.message}`);
            }
        }
    }
}

// Checa a cada 5 minutos
setInterval(checkAndKeepAlive, 5 * 60 * 1000);
checkAndKeepAlive(); // Executa agora