#!/usr/bin/env python3
"""Verify and reconstruct the self-contained experimental viewer payloads."""
from pathlib import Path
import argparse
import base64
import gzip
import hashlib
import json
import struct

ROOT = Path(__file__).resolve().parent


def sha(data):
    return hashlib.sha256(data).hexdigest()


def decompress(ref):
    compressed = bytearray()
    for part in ref['parts']:
        data = (ROOT / part['path']).read_bytes()
        if len(data) != part['bytes'] or sha(data) != part['sha256']:
            raise ValueError(f"Fragmento alterado: {part['path']}")
        compressed.extend(data)
    if sha(compressed) != ref['compressedSha256']:
        raise ValueError('Hash comprimido incorrecto')
    data = bytearray(gzip.decompress(compressed))
    if len(data) != ref['rawBytes'] or sha(data) != ref['rawSha256']:
        raise ValueError('Hash o tamaño de datos descomprimidos incorrecto')
    return data


def payload(ref):
    data = decompress(ref)
    if 'patch' in ref:
        patch = decompress(ref['patch'])
        count = struct.unpack_from('<I', patch)[0]
        if len(patch) != 4 + 8 * count:
            raise ValueError('Parche incompleto')
        previous = -1
        for index, bits in struct.iter_unpack('<II', memoryview(patch)[4:]):
            if index <= previous or 4 * index + 4 > len(data):
                raise ValueError('Índice de parche inválido')
            struct.pack_into('<I', data, 4 * index, bits)
            previous = index
        if sha(data) != ref['rawSha256AfterPatch']:
            raise ValueError('Hash del atlas reconstruido incorrecto')
    return data


def sources(rebuild):
    directory = ROOT / 'fuentes' / 'anatomical-maquette-102'
    manifest = json.loads((directory / 'FIELDS98.manifest.json').read_text())
    h = hashlib.sha256()
    target = directory / 'FIELDS98.npz'
    if rebuild and target.exists():
        raise FileExistsError(f'No se sobrescribe {target}')
    output = target.open('xb') if rebuild else None
    try:
        for part in manifest['parts']:
            data = (directory / part['path']).read_bytes()
            if len(data) != part['bytes'] or sha(data) != part['sha256']:
                raise ValueError(f"Fragmento alterado: {part['path']}")
            h.update(data)
            if output:
                output.write(data)
    finally:
        if output:
            output.close()
    if h.hexdigest() != manifest['sha256']:
        raise ValueError('Hash de FIELDS98 incorrecto')


def reconstruct_base_metadata():
    target = ROOT / 'fuentes' / 'anatomical-maquette-102' / 'VIEWER-DATA102-delivery.json'
    if target.exists():
        raise FileExistsError(f'No se sobrescribe {target}')
    data = json.loads((ROOT / 'metadatos-102.json').read_text())
    for key, value in data.items():
        if isinstance(value, dict) and '$payload' in value:
            ref = value['$payload']
            if 'patch' in ref:
                raise ValueError('La maqueta 102 no debe contener parche')
            compressed = b''.join((ROOT / part['path']).read_bytes() for part in ref['parts'])
            if sha(compressed) != ref['compressedSha256']:
                raise ValueError(f'Bloque comprimido alterado: {key}')
            data[key] = base64.b64encode(compressed).decode('ascii')
    with target.open('x') as file:
        json.dump(data, file, ensure_ascii=False, separators=(',', ':'))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--reconstruir-fuentes', action='store_true')
    args = parser.parse_args()
    if args.reconstruir_fuentes:
        directory = ROOT / 'fuentes' / 'anatomical-maquette-102'
        for name in ('FIELDS98.npz', 'VIEWER-DATA102-delivery.json'):
            if (directory / name).exists():
                raise FileExistsError(f'No se sobrescribe {directory / name}')
    for version in ('102', '103'):
        data = json.loads((ROOT / f'metadatos-{version}.json').read_text())
        keys = [key for key, value in data.items() if isinstance(value, dict) and '$payload' in value]
        if len(keys) != 13:
            raise ValueError(f'Número inesperado de bloques en {version}: {len(keys)}')
        for key in keys:
            payload(data[key]['$payload'])
        print(f'Maqueta {version}: {len(keys)} bloques verificados')
    sources(args.reconstruir_fuentes)
    if args.reconstruir_fuentes:
        reconstruct_base_metadata()
    print('Campos fuente: fragmentos verificados' + (' y reconstruidos' if args.reconstruir_fuentes else ''))


if __name__ == '__main__':
    main()
