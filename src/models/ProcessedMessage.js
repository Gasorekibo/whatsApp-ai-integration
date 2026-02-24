import { DataTypes } from 'sequelize';

export default (sequelize) => {
    const ProcessedMessage = sequelize.define('ProcessedMessage', {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true
        },
        messageId: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true
        },
        processedAt: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW
        }
    }, {
        tableName: 'processed_messages',
        timestamps: false
    });

    return ProcessedMessage;
};
