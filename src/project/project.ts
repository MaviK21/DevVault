import { AppError, ValidationError } from '../errors';

export class DuplicateProjectError extends AppError {
  constructor(readonly projectName: string) {
    super(`Проект «${projectName}» уже существует.`);
  }
}

export function validateProjectName(name: string): void {
  if (name.trim() === '') {
    throw new ValidationError('Название проекта не должно быть пустым.');
  }
  if (name.trim().length > 200) {
    throw new ValidationError('Название проекта слишком длинное (максимум 200 символов).');
  }
}
