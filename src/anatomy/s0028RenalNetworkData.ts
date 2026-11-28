// Generado por tools/anatomy/s0028-renal-network.ts (decisión 402). No editar a mano.
import { s0028Nodes } from './people/s0028/base62';

const hundredths = (s: string) => s0028Nodes(s, 100);
/**
 * Red interlobar del riñón derecho de s0028: [madre (1–3), es la madre (1) o una rama (0), arteria, vena], cada vaso como nodos
 * [x, y, z, r] en mm del mundo en el sentido del flujo (la arteria del seno a la arcuata; la vena, al revés), en centésimas de mm.
 * La vena de una madre conserva sus nodos originales al final, tal cual. [EXTRAPOLACIÓN PROPIA: la disposición.]
 */
export const S0028_RENAL_NETWORK: readonly (readonly [number, number, readonly (readonly number[])[], readonly (readonly number[])[]])[] = [
  [
    1,
    1,
    hundredths('TKAUezRAdV1mQFT6VjUqP1UzRUUlRRUHU0UlT4QqaMUlTiRGa9Uq'),
    [
      ...hundredths('T2yUSfRGGV0jWKYUPhVAX4YxP7VF'),
      [-70.67432508257312, -15.88526510587679, -150.2119480562941, 0.9],
      [-66.87325487622333, -16.29933341688848, -148.3668158875279, 1.3],
      [-63.87829643999417, -15.356358718827629, -149.00205024119347, 1.5],
    ],
  ],
  [
    2,
    1,
    hundredths('TUlUM0RhgV1mOzTeTcUqPuRxVuUlHPQXV6UlV4QqahUlVaRMaLUq'),
    [
      ...hundredths('T7AU3bRrEV0jUVYNPUVAUzYxOnVF'),
      [-64.26662980537927, -29.156968132998376, -128.31082613943855, 0.9],
      [-60.989999971153544, -27.681817523171006, -129.2146389562253, 1.3],
      [-57.20063918110279, -27.06982011979455, -128.54080367881218, 1.5],
    ],
  ],
  [
    3,
    1,
    hundredths('TgCU1zSGeV1mRiRJXlUqRRRcWQUlTKT3VvUlYxSPaEUlZ3SzZgUq'),
    [
      ...hundredths('TgHTmgSUWV0jR4WlQAVAQxXJPIVF'),
      [-54.50420045462547, -43.23814897769264, -103.72316047831042, 0.9],
      [-52.180614807593656, -41.554681461424366, -104.9381550719516, 1.3],
      [-50.079121178860404, -39.49733474877895, -106.8365159523852, 1.5],
    ],
  ],
  [1, 0, hundredths('TpNUbBRQpV1mYbZFW5UlWtXYViUlXZSsbNUgX4SbafUl'), hundredths('Ty1UecRflV0oSdXfPaVFRoXkOhVUSQT1UgVjQnRIUHVe')],
  [2, 0, hundredths('Tt2U95RigV1mcvURS3UlaiUlSwUlYERwaeUgXRSAaIUl'), hundredths('UCtU4IRpTV0oSiYGPtVFRrYwPKVUPXW9XLVjNHWPYDVe')],
  [1, 0, hundredths('TZzULFRN6V1mXHOZQgUlWkQZRwUlXcQpaFUgX9Raa4Ul'), hundredths('TknU3WRPlV0oTJYaPsVFT1ZePLVUU7ZoXrVjTWbnZ8Ve')],
  [3, 0, hundredths('TnxU6WRuOV1mZBkKbyUlYViDb1UlSwZdPMUgTBYZPuUl'), hundredths('TpjUhVRxQV0oWNRUaHVFWEQfaaVUQbHxPEVjPzFpOHVe')],
  [1, 0, hundredths('Ti1UW8R0lV1mbIXrLYUla1XNNZUlbSSbX0UgabSbXEUl'), hundredths('U5xUYSQoxV0oPXXqSyVFOQYHT8VUQ9TWcnVjOrSyekVe')],
  [1, 0, hundredths('TbvUXcRTFV1mRreSb8UlSNcTZsUlWHSgbgUgWOSTaoUl'), hundredths('TWmUiwRqzV0oTAXNPFVFStXFO4VUWhNHQAVjXILIOsVe')],
  [3, 0, hundredths('ToQU2uRsGV1mc2PtPrUlaRRFR7UlU5Y1O6UgTqXoPGUl'), hundredths('U0JU1ORWwV0oWVSXaoVFWLSjbgVUQDZVYxVjOYamaCVe')],
  [2, 0, hundredths('TiVUFERpSV1mGiWPaMUlIvW5ZSUlVeRYbGUgW6RtaaUl'), hundredths('TJJU9ESAFV0oTlXhPEVFU3XxO5VUgmT8Q4Vjj2SsPDVe')],
  [1, 0, hundredths('TUhUQ5RRTV1mHYPjWQUlJoQXW8UlRqXgOeUgSgXZPVUl'), hundredths('T15UJnRH2V0oXQS3aEVFYERrabVUgOYlTIVjidZbT1Ve')],
  [3, 0, hundredths('TfiU58RwJV1mLFKZSPUlMwMFSlUlWJQdaYUgWURRaDUl'), hundredths('TS8TcpS17V0oTqYJPXVFU7Z9OiVUdfdIWeVjfKf0X4Ve')],
  [3, 0, hundredths('TtPU5lS8VV1mYjZDeLUlXmYIcJUlUpcPTJUgUmbCT6Ul'), hundredths('TxUUR7SMLV0oUnOrX5VFUQO5WoVURLRuO0VjQTR0LwVe')],
  [1, 0, hundredths('TRsUQUR8RV1mS3ReNKUlT0SZPMUlUZbLQqUgUjaeRqUl'), hundredths('TOEUWRQn0V0oVjPHXzVFW8OyYiVUXtXRaGVjYmYLcKVe')],
  [1, 0, hundredths('TiGUehRV3V1mWVbTXzUlVpZLX3UlSwZdPMUgTBYZPuUl'), hundredths('TegUxxRQ8V0oWORUaHVFWEQeaaVUTGQqTDVjSeOgSFVe')],
];
