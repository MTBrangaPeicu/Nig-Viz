set -e

MARCELLE_ENCRYPTED_PWD=$(python3 -c 'import bcrypt; print(bcrypt.hashpw("'$MARCELLE_PWD'".encode(), bcrypt.gensalt(rounds=12)).decode())')

mongosh <<EOF
use $MONGO_INITDB_DATABASE  
db.users.insertOne({
	email: '$MARCELLE_LOGIN',
	username: 'admin',
	password: '$MARCELLE_ENCRYPTED_PWD',
	role: 'superadmin'
})
EOF
