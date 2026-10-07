import { AppError, ValidationError } from '../errors';

export class DuplicateProjectError extends AppError {
  constructor(readonly projectName: string) {
    super(`Project "${projectName}" already exists.`);
  }
}

export function validateProjectName(name: string): void {
  if (name.trim() === '') {
    throw new ValidationError('Project name must not be empty.');
  }
  if (name.trim().length > 200) {
    throw new ValidationError('Project name is too long (max 200 characters).');
  }
}
