#!/bin/sh
# Entrada del contenedor. Los volúmenes de Fly se montan con dueño root: se corrige el dueño de /data
# y se baja a un usuario sin privilegios antes de arrancar el servidor (el proceso de la app nunca corre como root).
set -e
if [ "$(id -u)" = "0" ]; then
  mkdir -p "${DATA_DIR:-/data}"
  chown -R node:node "${DATA_DIR:-/data}"
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"
