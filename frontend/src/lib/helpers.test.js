import { describe, it, expect } from 'vitest';
import { getUserName } from './helpers.js';

describe('getUserName', () => {
    it('should return the correct username for an existing user id', () => {
        const users = [
            { id: 1, username: 'alice' },
            { id: 2, username: 'bob' }
        ];
        expect(getUserName(2, users)).toBe('bob');
    });

    it('should return "Unknown User" for an invalid user id', () => {
        const users = [
            { id: 1, username: 'alice' },
            { id: 2, username: 'bob' }
        ];
        expect(getUserName(3, users)).toBe('Unknown User');
    });

    it('should return "Unknown User" if the users array is empty', () => {
        const users = [];
        expect(getUserName(1, users)).toBe('Unknown User');
    });
});
