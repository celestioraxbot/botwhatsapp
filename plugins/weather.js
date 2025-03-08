const axios = require('axios');

module.exports = {
    execute: async (message, args, client) => {
        if (args.length === 0) {
            return "Digite o nome da cidade! Exemplo: !weather São Paulo";
        }
        const city = args.join(' ');
        const apiKey = process.env.OPENWEATHERMAP_API_KEY;
        if (!apiKey) {
            return "API de clima não configurada.";
        }
        try {
            const response = await axios.get(
                `https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${apiKey}&units=metric&lang=pt_br`
            );
            const { main, weather } = response.data;
            return `Clima em ${city}: ${weather[0].description}, ${main.temp}°C, sensação térmica de ${main.feels_like}°C. 🌤️`;
        } catch (error) {
            return "Não consegui encontrar o clima para essa cidade. Tente outra!";
        }
    }
};