import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import dotenv from 'dotenv';
dotenv.config();

const PORT = process.env.PORT || 3000;

export const swaggerOptions = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Manifest Ghost Palette API',
            version: '30.4.0',
            description: 'API documentation for Manifest Ghost Palette. Explains how to integrate with Microsoft Outlook and Power Automate using API keys (x-api-key header), manage tasks, and leverage background Google Drive file storage/processing when users are offline or unauthenticated.',
        },
        servers: [
            {
                url: process.env.BASE_URL || `http://localhost:${PORT}`,
                description: 'Configured server'
            },
            {
                url: 'https://ghost.s1.buzzedtop.com',
                description: 'Production server'
            }
        ],
        components: {
            securitySchemes: {
                ApiKeyAuth: {
                    type: 'apiKey',
                    in: 'header',
                    name: 'x-api-key'
                },
                CookieAuth: {
                    type: 'apiKey',
                    in: 'cookie',
                    name: 'connect.sid'
                }
            }
        }
    },
    apis: ['./backend/routes/*.js'],
};

export const swaggerSpecs = swaggerJsdoc(swaggerOptions);
export { swaggerUi };
