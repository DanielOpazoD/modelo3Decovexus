import { REPOSITORY_ENV } from './gitEnvironment';

// Antes de cualquier prueba: ningún `git` lanzado desde aquí hereda un repositorio ajeno al directorio en que corre.
for (const key of REPOSITORY_ENV) delete process.env[key];
